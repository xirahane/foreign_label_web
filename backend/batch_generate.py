"""
批量化异物生成脚本

用法:
    python batch_generate.py \
        --bg_dir ./backgrounds \
        --obj_dirs ./objects/条状 ./objects/点状 ./objects/块状 \
        --output ./output \
        --total 100 \
        --obj_count_min 1 --obj_count_max 5 \
        --scale_min 50 --scale_max 150 \
        --rotation_min 0 --rotation_max 360

也可作为模块导入:
    from batch_generate import batch_generate, GenerationConfig
"""

import cv2
import numpy as np
import os
import sys
import random
import argparse
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path


# ─── Data structures ───────────────────────────────────────────────

@dataclass
class GenerationConfig:
    """生成参数配置"""
    bg_dir: str                          # 背景图文件夹路径
    obj_dirs: list[str] = field(default_factory=list)  # 异物素材文件夹列表
    output_dir: str = "./output"          # 输出目录
    total_count: int = 100                # 生成总张数
    obj_count_min: int = 1                # 每张图最少异物数
    obj_count_max: int = 5                # 每张图最多异物数
    scale_min: int = 50                   # 缩放最小百分比
    scale_max: int = 150                  # 缩放最大百分比
    rotation_min: int = 0                 # 旋转最小角度
    rotation_max: int = 360               # 旋转最大角度
    edge_margin: int = 20                 # 边缘留白（像素）
    blend_mode: str = "direct"            # 融合模式: "direct" | "poisson"
    bbox_strategy: str = "tight"          # 标注框策略: "tight" | "expand"
    bbox_expand_ratio: int = 10           # 扩张比例（百分比）
    max_dim: int = 400                    # 自动检测时的降采样最大尺寸
    class_name: str = "0"                 # classes.txt 内容（默认只有 0）


# ─── Helper functions ───────────────────────────────────────────────

def load_image(path: str) -> np.ndarray:
    """读取图像，支持透明通道"""
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"无法读取图像: {path}")
    return img


def random_in_range(mn: float, mx: float) -> float:
    return random.random() * (mx - mn) + mn


def point_in_polygon(px: float, py: float, poly: np.ndarray) -> bool:
    """射线法判断点是否在多边形内"""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def corners_inside(corners: list[tuple[float, float]], poly: np.ndarray) -> bool:
    """检查四个角是否都在多边形内"""
    return all(point_in_polygon(cx, cy, poly) for cx, cy in corners)


# ─── Auto-detect tilted boundary (PCA-based) ────────────────────────

def detect_tilted_boundary(img: np.ndarray, max_dim: int = 400) -> Optional[np.ndarray]:
    """
    自动检测 X 光图中异物的倾斜生成区域。
    返回 4 个角点的 numpy 数组 shape=(4,2)，或 None。
    """
    h, w = img.shape[:2]
    scale = min(1.0, max_dim / max(w, h))
    sw, sh = int(round(w * scale)), int(round(h * scale))
    small = cv2.resize(img, (sw, sh))

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)

    # 小核形态学闭运算填补空洞
    close_ksize = max(3, int(min(sw, sh) * 0.02))
    if close_ksize % 2 == 0:
        close_ksize += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_ksize, close_ksize))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    # 收集白色像素
    ys, xs = np.where(closed > 128)
    if len(xs) < 10:
        return None

    # PCA 求主方向
    cx = np.mean(xs)
    cy = np.mean(ys)
    dx = xs - cx
    dy = ys - cy
    xx = np.mean(dx * dx)
    yy = np.mean(dy * dy)
    xy = np.mean(dx * dy)

    theta = 0.5 * np.arctan2(2 * xy, xx - yy)
    cos_t, sin_t = np.cos(theta), np.sin(theta)

    # 投影到主轴找包围盒
    u = dx * cos_t + dy * sin_t
    v = -dx * sin_t + dy * cos_t
    min_u, max_u = u.min(), u.max()
    min_v, max_v = v.min(), v.max()

    margin = min(max_u - min_u, max_v - min_v) * 0.02
    min_u -= margin; max_u += margin
    min_v -= margin; max_v += margin

    # 四个角（缩放回原图）
    inv_sx = w / sw
    inv_sy = h / sh
    corners = np.array([
        [cx + min_u * cos_t - min_v * sin_t, cy + min_u * sin_t + min_v * cos_t],
        [cx + max_u * cos_t - min_v * sin_t, cy + max_u * sin_t + min_v * cos_t],
        [cx + max_u * cos_t - max_v * sin_t, cy + max_u * sin_t + max_v * cos_t],
        [cx + min_u * cos_t - max_v * sin_t, cy + min_u * sin_t + max_v * cos_t],
    ], dtype=np.float64)
    corners[:, 0] *= inv_sx
    corners[:, 1] *= inv_sy

    corners[:, 0] = np.clip(corners[:, 0], 0, w)
    corners[:, 1] = np.clip(corners[:, 1], 0, h)

    return corners.astype(np.int32)


# ─── Placement within polygon ───────────────────────────────────────

def generate_placement(
    img_w: int, img_h: int,
    obj_w: int, obj_h: int,
    config: GenerationConfig,
    polygon: Optional[np.ndarray] = None,
) -> Optional[dict]:
    """
    在背景图上随机放置异物，返回位置信息或 None（放不下时）。
    """
    scale = random_in_range(config.scale_min, config.scale_max) / 100.0
    w = int(obj_w * scale)
    h = int(obj_h * scale)

    margin = config.edge_margin
    rotation = random_in_range(config.rotation_min, config.rotation_max)

    if polygon is not None and len(polygon) >= 3:
        min_x = int(polygon[:, 0].min())
        max_x = int(polygon[:, 0].max())
        min_y = int(polygon[:, 1].min())
        max_y = int(polygon[:, 1].max())

        for _ in range(100):
            x = int(random_in_range(min_x + margin, max(max_x + margin, max_x - margin - w)))
            y = int(random_in_range(min_y + margin, max(max_y + margin, max_y - margin - h)))
            corners = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
            if corners_inside(corners, polygon):
                return {"x": x, "y": y, "w": w, "h": h, "rotation": rotation, "scale": scale}

        # 回退到多边形中心
        cx = int((min_x + max_x) // 2 - w // 2)
        cy = int((min_y + max_y) // 2 - h // 2)
        return {"x": cx, "y": cy, "w": w, "h": h, "rotation": rotation, "scale": scale}

    # 无多边形时在整个图像范围内放置
    bx = margin
    by = margin
    bw = img_w - margin * 2
    bh = img_h - margin * 2
    x = int(random_in_range(max(bx, bx + bw - w), bx + bw - w)) if bw > w else bx
    y = int(random_in_range(max(by, by + bh - h), by + bh - h)) if bh > h else by
    x = max(bx, min(x, bx + bw - w))
    y = max(by, min(y, by + bh - h))

    return {"x": x, "y": y, "w": w, "h": h, "rotation": rotation, "scale": scale}


# ─── Compose a single image ─────────────────────────────────────────

def compose_single(
    bg_path: str,
    obj_paths: list[str],
    config: GenerationConfig,
) -> tuple[np.ndarray, list[str]]:
    """
    合成一张图。
    返回 (合成图像 BGR, YOLO 标注行列表)
    """
    bg = load_image(bg_path)
    if bg.shape[2] == 4:
        bg = cv2.cvtColor(bg, cv2.COLOR_BGRA2BGR)
    bg_h, bg_w = bg.shape[:2]

    polygon = detect_tilted_boundary(bg, config.max_dim)

    count = random.randint(config.obj_count_min, config.obj_count_max)
    labels = []

    for _ in range(count):
        if not obj_paths:
            break
        obj_path = random.choice(obj_paths)
        obj = load_image(obj_path)

        if obj is None:
            continue

        # 如果有 alpha 通道，分离
        has_alpha = obj.shape[2] == 4
        obj_h, obj_w = obj.shape[:2]

        placement = generate_placement(bg_w, bg_h, obj_w, obj_h, config, polygon)
        if placement is None:
            continue

        x, y = placement["x"], placement["y"]
        w, h = placement["w"], placement["h"]
        rotation = placement["rotation"]

        # 缩放 + 旋转
        obj_resized = cv2.resize(obj, (w, h))

        if rotation != 0:
            M = cv2.getRotationMatrix2D((w // 2, h // 2), rotation, 1.0)
            if has_alpha:
                obj_resized = cv2.warpAffine(
                    obj_resized, M, (w, h),
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_CONSTANT,
                    borderValue=(0, 0, 0, 0),
                )
            else:
                obj_resized = cv2.warpAffine(
                    obj_resized, M, (w, h),
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_CONSTANT,
                    borderValue=(0, 0, 0),
                )

        # 融合
        y1 = max(0, y)
        x1 = max(0, x)
        y2 = min(bg_h, y + h)
        x2 = min(bg_w, x + w)

        if y2 <= y1 or x2 <= x1:
            continue

        if has_alpha:
            alpha = obj_resized[:y2 - y1, :x2 - x1, 3].astype(np.float32) / 255.0
            alpha = alpha[:, :, np.newaxis]
            fg_rgb = obj_resized[:y2 - y1, :x2 - x1, :3].astype(np.float32)
            roi = bg[y1:y2, x1:x2].astype(np.float32)
            blended = fg_rgb * alpha + roi * (1 - alpha)
            bg[y1:y2, x1:x2] = blended.astype(np.uint8)
        else:
            obj_slice = obj_resized[:y2 - y1, :x2 - x1]
            bg[y1:y2, x1:x2] = obj_slice

        # 生成 YOLO 标注
        aabb_x = x
        aabb_y = y
        aabb_w = w
        aabb_h = h

        if config.bbox_strategy == "expand":
            ratio = config.bbox_expand_ratio / 100.0
            aabb_x = max(0, x - w * ratio / 2)
            aabb_y = max(0, y - h * ratio / 2)
            aabb_w = min(w * (1 + ratio), bg_w - aabb_x)
            aabb_h = min(h * (1 + ratio), bg_h - aabb_y)

        cx = (aabb_x + aabb_w / 2) / bg_w
        cy = (aabb_y + aabb_h / 2) / bg_h
        nw = aabb_w / bg_w
        nh = aabb_h / bg_h

        labels.append(f"0 {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}")

    return bg, labels


# ─── Batch entry ────────────────────────────────────────────────────

def batch_generate(config: GenerationConfig, progress_callback=None) -> int:
    """
    批量生成主函数。
    返回生成的总张数。
    """
    bg_dir = Path(config.bg_dir)
    if not bg_dir.exists():
        raise FileNotFoundError(f"背景图文件夹不存在: {config.bg_dir}")

    bg_files = list(bg_dir.glob("*"))
    bg_files = [f for f in bg_files if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}]
    if not bg_files:
        raise FileNotFoundError(f"背景图文件夹中没有找到图像: {config.bg_dir}")

    obj_files = []
    for obj_dir in config.obj_dirs:
        d = Path(obj_dir)
        if not d.exists():
            print(f"[警告] 异物文件夹不存在，跳过: {obj_dir}", file=sys.stderr)
            continue
        for ext in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
            obj_files.extend(str(p) for p in d.glob(f"*{ext}"))
            obj_files.extend(str(p) for p in d.glob(f"*{ext.upper()}"))

    if not obj_files:
        raise FileNotFoundError("没有找到任何异物素材")

    out_dir = Path(config.output_dir)
    img_dir = out_dir / "images"
    lbl_dir = out_dir / "labels"
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    total = config.total_count
    for i in range(total):
        bg_path = str(random.choice(bg_files))
        try:
            img, labels = compose_single(bg_path, obj_files, config)
        except Exception as e:
            print(f"[警告] 第 {i+1} 张合成失败 ({bg_path}): {e}", file=sys.stderr)
            continue

        idx = str(i + 1).zfill(4)
        cv2.imwrite(str(img_dir / f"{idx}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])

        with open(lbl_dir / f"{idx}.txt", "w") as f:
            f.write("\n".join(labels))

        if progress_callback:
            progress_callback(i + 1, total)

    # classes.txt
    with open(out_dir / "classes.txt", "w") as f:
        f.write(config.class_name)

    return total


# ─── CLI entry ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="批量化异物生成脚本")
    parser.add_argument("--bg_dir", required=True, help="背景图文件夹路径")
    parser.add_argument("--obj_dirs", nargs="+", required=True, help="异物素材文件夹列表")
    parser.add_argument("--output", default="./output", help="输出目录 (默认: ./output)")
    parser.add_argument("--total", type=int, default=100, help="生成总张数 (默认: 100)")
    parser.add_argument("--obj_count_min", type=int, default=1, help="每张图最少异物数 (默认: 1)")
    parser.add_argument("--obj_count_max", type=int, default=5, help="每张图最多异物数 (默认: 5)")
    parser.add_argument("--scale_min", type=int, default=50, help="缩放最小百分比 (默认: 50)")
    parser.add_argument("--scale_max", type=int, default=150, help="缩放最大百分比 (默认: 150)")
    parser.add_argument("--rotation_min", type=int, default=0, help="旋转最小角度 (默认: 0)")
    parser.add_argument("--rotation_max", type=int, default=360, help="旋转最大角度 (默认: 360)")
    parser.add_argument("--edge_margin", type=int, default=20, help="边缘留白像素 (默认: 20)")
    parser.add_argument("--blend_mode", default="direct", choices=["direct", "poisson"], help="融合模式 (默认: direct)")
    parser.add_argument("--bbox_strategy", default="tight", choices=["tight", "expand"], help="标注框策略 (默认: tight)")
    parser.add_argument("--bbox_expand", type=int, default=10, help="扩张比例 (默认: 10)")
    parser.add_argument("--max_dim", type=int, default=400, help="自动检测降采样最大尺寸 (默认: 400)")

    args = parser.parse_args()

    config = GenerationConfig(
        bg_dir=args.bg_dir,
        obj_dirs=args.obj_dirs,
        output_dir=args.output,
        total_count=args.total,
        obj_count_min=args.obj_count_min,
        obj_count_max=args.obj_count_max,
        scale_min=args.scale_min,
        scale_max=args.scale_max,
        rotation_min=args.rotation_min,
        rotation_max=args.rotation_max,
        edge_margin=args.edge_margin,
        blend_mode=args.blend_mode,
        bbox_strategy=args.bbox_strategy,
        bbox_expand_ratio=args.bbox_expand,
        max_dim=args.max_dim,
    )

    print(f"背景图文件夹: {config.bg_dir}")
    print(f"异物素材文件夹: {config.obj_dirs}")
    print(f"输出目录: {config.output_dir}")
    print(f"生成张数: {config.total_count}")
    print(f"异物数量范围: {config.obj_count_min}~{config.obj_count_max}")
    print(f"缩放范围: {config.scale_min}%~{config.scale_max}%")
    print(f"旋转范围: {config.rotation_min}°~{config.rotation_max}°")
    print(f"融合模式: {config.blend_mode}")
    print(f"标注框策略: {config.bbox_strategy}")
    print()
    print("开始生成...")

    def progress(current, total):
        print(f"\r进度: {current}/{total} ({100*current//total}%)", end="", flush=True)

    try:
        count = batch_generate(config, progress)
        print(f"\n完成！共生成了 {count} 张图像")
        print(f"图像目录: {Path(config.output_dir) / 'images'}")
        print(f"标注目录: {Path(config.output_dir) / 'labels'}")
        print(f"类别文件: {Path(config.output_dir) / 'classes.txt'}")
    except Exception as e:
        print(f"\n错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
