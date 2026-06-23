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
        --rotation_min 0 --rotation_max 360 \
        --viz_boxes

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
    edge_margin: int = 40                 # 边缘留白（像素）
    blend_mode: str = "direct"            # 融合模式: "direct" | "poisson"
    bbox_strategy: str = "tight"          # 标注框策略: "tight" | "expand"
    bbox_expand_ratio: int = 10           # 扩张比例（百分比）
    max_dim: int = 400                    # 自动检测时的降采样最大尺寸
    class_name: str = "0"                 # classes.txt 内容（默认只有 0）
    viz_boxes: bool = False               # 是否生成背景图检测区域可视化


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


def read_existing_labels(bg_path: str) -> list[str]:
    """读取背景图已有的 YOLO 标注文件（同名 .txt），不存在则返回空列表"""
    txt_path = Path(bg_path).with_suffix(".txt")
    if txt_path.exists():
        with open(txt_path, "r") as f:
            return [line.strip() for line in f if line.strip()]
    return []


# ─── Auto-detect tilted boundary ────────────────────────────────────

def _otsu_threshold(gray: np.ndarray) -> int:
    """大津法自动阈值"""
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    total = gray.size
    sum_total = np.dot(np.arange(256), hist)
    sum_b = 0.0
    w_b = 0
    max_var = 0.0
    threshold = 128
    for t in range(256):
        w_b += hist[t]
        if w_b == 0: continue
        w_f = total - w_b
        if w_f == 0: break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_total - sum_b) / w_f
        var_between = w_b * w_f * (m_b - m_f) ** 2
        if var_between > max_var:
            max_var = var_between
            threshold = t
    return threshold


def detect_tilted_boundary(img: np.ndarray, max_dim: int = 400) -> Optional[np.ndarray]:
    """
    自动检测 X 光图中异物的倾斜生成区域。
    使用百分位阈值 + 形态学闭运算 + 多连通分量合并 + 凸包最小面积矩形。
    返回 4 个角点的 numpy 数组 shape=(4,2)，或 None。
    """
    h, w = img.shape[:2]
    scale = min(1.0, max_dim / max(w, h))
    sw, sh = int(round(w * scale)), int(round(h * scale))
    small = cv2.resize(img, (sw, sh))

    if len(small.shape) == 3 and small.shape[2] >= 3:
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    elif len(small.shape) == 2:
        gray = small
    else:
        gray = small[:, :, 0] if small.shape[2] >= 1 else small

    # Otsu 阈值分割
    otsu_thresh = _otsu_threshold(gray)
    _, binary = cv2.threshold(gray, otsu_thresh, 255, cv2.THRESH_BINARY_INV)

    # 形态学闭运算 — 6% 核融合碎片化暗区
    close_ksize = max(7, int(min(sw, sh) * 0.06))
    if close_ksize % 2 == 0:
        close_ksize += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_ksize, close_ksize))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    # 提取所有连通分量，保留面积 ≥ 最大分量 10% 的
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=4)
    if num_labels <= 1:
        return None

    areas = stats[1:, cv2.CC_STAT_AREA]
    if len(areas) == 0:
        return None
    max_area = areas.max()
    min_keep = max_area * 0.10

    merged = np.zeros_like(closed)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_keep:
            merged[labels == i] = 255

    if merged.sum() == 0:
        return None

    # 凸包
    ys_px, xs_px = np.where(merged > 128)
    pts = np.column_stack([xs_px, ys_px]).astype(np.float32)
    hull = cv2.convexHull(pts)

    if hull is None or len(hull) < 3:
        return None

    # 最小面积旋转矩形
    rect = cv2.minAreaRect(hull)
    corners = cv2.boxPoints(rect).astype(np.float64)

    # 缩放回原图
    inv_sx = w / sw
    inv_sy = h / sh
    corners[:, 0] *= inv_sx
    corners[:, 1] *= inv_sy
    corners[:, 0] = np.clip(corners[:, 0], 0, w)
    corners[:, 1] = np.clip(corners[:, 1], 0, h)

    return corners.astype(np.int32)


def draw_polygon_on_image(img: np.ndarray, corners: np.ndarray, color=(0, 255, 0)) -> np.ndarray:
    """在图像上绘制多边形框，用于可视化"""
    if len(img.shape) == 2:
        vis = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    else:
        vis = img.copy()
    if corners is not None and len(corners) >= 3:
        pts = corners.reshape((-1, 1, 2))
        cv2.polylines(vis, [pts], isClosed=True, color=color, thickness=2)
    return vis


# ─── Placement within polygon ───────────────────────────────────────

def generate_placement(
    img_w: int, img_h: int,
    obj_w: int, obj_h: int,
    config: GenerationConfig,
    polygon: Optional[np.ndarray] = None,
) -> Optional[dict]:
    """在背景图上随机放置异物，返回位置信息或 None（放不下时）。"""
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
            x = int(random_in_range(min_x + margin, max_x - margin - w + 1)) if max_x - min_x > w + margin * 2 else min_x
            y = int(random_in_range(min_y + margin, max_y - margin - h + 1)) if max_y - min_y > h + margin * 2 else min_y
            x = max(min_x + margin, min(x, max_x - margin - w))
            y = max(min_y + margin, min(y, max_y - margin - h))
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
    x = int(random_in_range(bx, bx + bw - w)) if bw > w else bx
    y = int(random_in_range(by, by + bh - h)) if bh > h else by
    x = max(bx, min(x, bx + bw - w))
    y = max(by, min(y, by + bh - h))

    return {"x": x, "y": y, "w": w, "h": h, "rotation": rotation, "scale": scale}


# ─── Compose a single image ─────────────────────────────────────────

def compose_single(
    bg_path: str,
    obj_paths: list[str],
    config: GenerationConfig,
    polygon: Optional[np.ndarray] = None,
) -> tuple[np.ndarray, list[str]]:
    """
    合成一张图。
    返回 (合成图像 BGR, YOLO 标注行列表)
    """
    bg = load_image(bg_path)
    if len(bg.shape) == 3 and bg.shape[2] == 4:
        bg = cv2.cvtColor(bg, cv2.COLOR_BGRA2BGR)
    elif len(bg.shape) == 2:
        bg = cv2.cvtColor(bg, cv2.COLOR_GRAY2BGR)
    bg_h, bg_w = bg.shape[:2]

    if polygon is None:
        polygon = detect_tilted_boundary(bg, config.max_dim)

    # 计算生成区域面积（用于小框扩张阈值）
    if polygon is not None and len(polygon) >= 3:
        region_area = float(cv2.contourArea(polygon.astype(np.float32)))
    else:
        region_area = float(bg_w * bg_h)
    min_bbox_area = region_area * 0.001

    # 合并已有标注（小框以中心等比扩张到区域面积的 0.1%）
    raw_labels = read_existing_labels(bg_path)
    labels = []
    for line in raw_labels:
        parts = line.split()
        if len(parts) >= 5:
            clsid, cx_n, cy_n, w_n, h_n = parts[0], float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            abs_w = w_n * bg_w
            abs_h = h_n * bg_h
            if abs_w * abs_h < min_bbox_area:
                scale_factor = (min_bbox_area / (abs_w * abs_h)) ** 0.5
                abs_w *= scale_factor
                abs_h *= scale_factor
                w_n = abs_w / bg_w
                h_n = abs_h / bg_h
            labels.append(f"{clsid} {cx_n:.6f} {cy_n:.6f} {w_n:.6f} {h_n:.6f}")
        else:
            labels.append(line)

    if polygon is None:
        polygon = detect_tilted_boundary(bg, config.max_dim)

    count = random.randint(config.obj_count_min, config.obj_count_max)

    for _ in range(count):
        if not obj_paths:
            break
        obj_path = random.choice(obj_paths)
        obj = load_image(obj_path)

        if obj is None:
            continue

        has_alpha = len(obj.shape) == 3 and obj.shape[2] == 4
        obj_h, obj_w = obj.shape[:2]

        placement = generate_placement(bg_w, bg_h, obj_w, obj_h, config, polygon)
        if placement is None:
            continue

        x, y = placement["x"], placement["y"]
        w, h = placement["w"], placement["h"]
        rotation = placement["rotation"]

        obj_resized = cv2.resize(obj, (w, h))

        if rotation != 0:
            M = cv2.getRotationMatrix2D((w // 2, h // 2), rotation, 1.0)
            border_val = (0, 0, 0, 0) if has_alpha else (0, 0, 0)
            obj_resized = cv2.warpAffine(
                obj_resized, M, (w, h),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=border_val,
            )

        y1, x1 = max(0, y), max(0, x)
        y2, x2 = min(bg_h, y + h), min(bg_w, x + w)

        if y2 <= y1 or x2 <= x1:
            continue

        if has_alpha:
            alpha = obj_resized[:y2 - y1, :x2 - x1, 3].astype(np.float32) / 255.0
            alpha = alpha[:, :, np.newaxis]
            fg_rgb = obj_resized[:y2 - y1, :x2 - x1, :3].astype(np.float32)
            roi = bg[y1:y2, x1:x2].astype(np.float32)
            bg[y1:y2, x1:x2] = (fg_rgb * alpha + roi * (1 - alpha)).astype(np.uint8)
        else:
            bg[y1:y2, x1:x2] = obj_resized[:y2 - y1, :x2 - x1]

        aabb_x, aabb_y = x, y
        aabb_w, aabb_h = w, h

        if config.bbox_strategy == "expand":
            ratio = config.bbox_expand_ratio / 100.0
            aabb_x = max(0, x - w * ratio / 2)
            aabb_y = max(0, y - h * ratio / 2)
            aabb_w = min(w * (1 + ratio), bg_w - aabb_x)
            aabb_h = min(h * (1 + ratio), bg_h - aabb_y)

        # 小标注框以中心等比扩张到区域面积的 0.1%
        bbox_area = aabb_w * aabb_h
        if bbox_area < min_bbox_area and bbox_area > 0:
            scale_factor = (min_bbox_area / bbox_area) ** 0.5
            cx_abs = aabb_x + aabb_w / 2
            cy_abs = aabb_y + aabb_h / 2
            aabb_w *= scale_factor
            aabb_h *= scale_factor
            aabb_x = cx_abs - aabb_w / 2
            aabb_y = cy_abs - aabb_h / 2

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

    # 可视化目录
    box_dir = None
    if config.viz_boxes:
        box_dir = out_dir / "backgrounds_box"
        box_dir.mkdir(parents=True, exist_ok=True)

    total = config.total_count

    # 预检测并缓存每张背景的生成区域
    bg_cache: dict[str, np.ndarray] = {}
    for bg_path in bg_files:
        bg_key = str(bg_path)
        try:
            bg_img = load_image(bg_key)
            polygon = detect_tilted_boundary(bg_img, config.max_dim)
            if polygon is not None:
                bg_cache[bg_key] = polygon
            if box_dir is not None:
                vis_img = draw_polygon_on_image(bg_img, polygon)
                cv2.imwrite(str(box_dir / f"{bg_path.stem}_box.jpg"), vis_img,
                            [cv2.IMWRITE_JPEG_QUALITY, 95])
        except Exception as e:
            print(f"[警告] 预检测失败 ({bg_path.name}): {e}", file=sys.stderr)

    for i in range(total):
        bg_path = str(random.choice(bg_files))
        polygon = bg_cache.get(bg_path)
        try:
            img, labels = compose_single(bg_path, obj_files, config, polygon)
        except Exception as e:
            print(f"[警告] 第 {i+1} 张合成失败 ({bg_path}): {e}", file=sys.stderr)
            continue

        idx = str(i + 1).zfill(4)
        cv2.imwrite(str(img_dir / f"{idx}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])

        with open(lbl_dir / f"{idx}.txt", "w") as f:
            f.write("\n".join(labels))

        if progress_callback:
            progress_callback(i + 1, total)

    # classes.txt 放入 labels 文件夹
    with open(lbl_dir / "classes.txt", "w") as f:
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
    parser.add_argument("--edge_margin", type=int, default=40, help="边缘留白像素 (默认: 40)")
    parser.add_argument("--blend_mode", default="direct", choices=["direct", "poisson"],
                        help="融合模式 (默认: direct)")
    parser.add_argument("--bbox_strategy", default="tight", choices=["tight", "expand"],
                        help="标注框策略 (默认: tight)")
    parser.add_argument("--bbox_expand", type=int, default=10, help="扩张比例 (默认: 10)")
    parser.add_argument("--max_dim", type=int, default=400, help="自动检测降采样最大尺寸 (默认: 400)")
    parser.add_argument("--viz_boxes", action="store_true",
                        help="生成 backgrounds_box 文件夹，保存检测区域可视化图像")

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
        viz_boxes=args.viz_boxes,
    )

    print(f"背景图文件夹: {config.bg_dir}")
    print(f"异物素材文件夹: {config.obj_dirs}")
    print(f"输出目录: {config.output_dir}")
    print(f"生成张数: {config.total_count}")
    print(f"异物数量范围: {config.obj_count_min}~{config.obj_count_max}")
    print(f"缩放范围: {config.scale_min}%~{config.scale_max}%")
    print(f"旋转范围: {config.rotation_min}°~{config.rotation_max}°")
    print(f"边缘留白: {config.edge_margin}px")
    print(f"融合模式: {config.blend_mode}")
    print(f"标注框策略: {config.bbox_strategy}")
    if config.viz_boxes:
        print(f"可视化输出: {Path(config.output_dir) / 'backgrounds_box'}")
    print()
    print("开始生成...")

    def progress(current, total):
        print(f"\r进度: {current}/{total} ({100*current//total}%)", end="", flush=True)

    try:
        count = batch_generate(config, progress)
        print(f"\n完成！共生成了 {count} 张图像")
        print(f"图像目录: {Path(config.output_dir) / 'images'}")
        print(f"标注目录: {Path(config.output_dir) / 'labels'}")
        if config.viz_boxes:
            print(f"检测区域可视化: {Path(config.output_dir) / 'backgrounds_box'}")
    except Exception as e:
        print(f"\n错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
