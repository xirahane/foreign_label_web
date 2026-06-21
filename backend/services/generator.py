import cv2
import numpy as np
import random
import os
import time
from .image_processor import img_to_bytes, trim_transparent_bytes, read_image

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "storage")


def random_in_range(mn: float, mx: float) -> float:
    return random.random() * (mx - mn) + mn


def generate_label(
    obj_x: float, obj_y: float,
    obj_w: float, obj_h: float,
    img_w: int, img_h: int,
    class_id: int,
    bbox_strategy: str = "tight",
    bbox_expand: int = 10,
) -> str:
    bx, by = obj_x, obj_y
    bw, bh = obj_w, obj_h

    if bbox_strategy == "expand":
        ratio = bbox_expand / 100.0
        expand_x = bw * ratio
        expand_y = bh * ratio
        bx = max(0, bx - expand_x / 2)
        by = max(0, by - expand_y / 2)
        bw = min(bw + expand_x, img_w - bx)
        bh = min(bh + expand_y, img_h - by)

    cx = (bx + bw / 2) / img_w
    cy = (by + bh / 2) / img_h
    w = bw / img_w
    h = bh / img_h

    return f"{class_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def feather_blend(bg: np.ndarray, fg: np.ndarray, x: int, y: int, w: int, h: int, strength: int):
    """Blend foreground onto background with feathering at edges."""
    fg_resized = cv2.resize(fg, (w, h))

    mask = np.ones((h, w), dtype=np.float32)
    feather_size = max(1, int(strength / 100.0 * 20))
    cv2.rectangle(mask, (0, 0), (w - 1, h - 1), 0, feather_size * 2)
    mask_shape = mask.shape

    mask[:feather_size, :] *= np.linspace(0, 1, feather_size)[:, np.newaxis]
    mask[-feather_size:, :] *= np.linspace(1, 0, feather_size)[:, np.newaxis]
    mask[:, :feather_size] *= np.linspace(0, 1, feather_size)[np.newaxis, :]
    mask[:, -feather_size:] *= np.linspace(1, 0, feather_size)[np.newaxis, :]

    mask = mask[:, :, np.newaxis]

    roi = bg[y:y+h, x:x+w].astype(np.float32)
    fg_float = fg_resized[:, :, :3].astype(np.float32)
    blended = fg_float * mask + roi * (1 - mask)
    bg[y:y+h, x:x+w] = blended.astype(np.uint8)


def compose_image(
    bg_path: str,
    object_paths: list[str],
    params: dict,
    class_ids: list[int],
) -> tuple[bytes, list[str]]:
    """
    Compose a single image and return (image_bytes, yolo_labels).
    """
    bg = read_image(bg_path)
    bg_h, bg_w = bg.shape[:2]

    labels = []
    count = random.randint(params.get("object_count_min", 1), params.get("object_count_max", 5))

    for _ in range(count):
        obj_path = random.choice(object_paths)
        obj = cv2.imread(obj_path, cv2.IMREAD_UNCHANGED)
        if obj is None or obj.shape[2] < 4:
            continue

        obj_h, obj_w = obj.shape[:2]

        # Scale
        scale = random_in_range(params.get("scale_min", 50), params.get("scale_max", 150)) / 100.0
        w = int(obj_w * scale)
        h = int(obj_h * scale)

        # Position within boundary
        edge_margin = params.get("edge_margin", 20)
        mx = edge_margin
        my = edge_margin
        mw = bg_w - edge_margin * 2
        mh = bg_h - edge_margin * 2

        x = int(random_in_range(mx, max(mx, mx + mw - w)))
        y = int(random_in_range(my, max(my, my + mh - h)))

        # Rotation
        if params.get("rotation_max", 0) > params.get("rotation_min", 0):
            angle = random_in_range(params["rotation_min"], params["rotation_max"])
            M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
            rotated = cv2.warpAffine(obj, M, (w, h),
                                     flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_CONSTANT,
                                     borderValue=(0, 0, 0, 0))
            obj = rotated

        # Blend
        blend_strength = params.get("edge_blend", 50)
        y_clamped = max(0, min(y, bg_h - h))
        x_clamped = max(0, min(x, bg_w - w))

        feather_blend(bg, obj, x_clamped, y_clamped, w, h, blend_strength)

        class_id = 0
        if obj_path in class_ids:
            class_id = class_ids[obj_path]

        label = generate_label(
            x_clamped, y_clamped, w, h,
            bg_w, bg_h, class_id,
            params.get("bbox_strategy", "tight"),
            params.get("bbox_expand", 10),
        )
        labels.append(label)

    return img_to_bytes(bg, ".jpg"), labels


def batch_generate(
    bg_path: str,
    object_paths: list[str],
    params: dict,
    categories: list[str],
    output_dir: str,
    progress_callback=None,
) -> int:
    """
    Generate multiple images and save them. Returns count generated.
    """
    os.makedirs(os.path.join(output_dir, "images"), exist_ok=True)
    os.makedirs(os.path.join(output_dir, "labels"), exist_ok=True)

    class_ids = {}
    for i, cat in enumerate(categories):
        class_ids[cat] = i

    total = params.get("total_count", 10)

    for i in range(total):
        img_bytes, labels = compose_image(bg_path, object_paths, params, class_ids)

        idx_str = str(i + 1).zfill(4)
        img_file = os.path.join(output_dir, "images", f"{idx_str}.jpg")
        label_file = os.path.join(output_dir, "labels", f"{idx_str}.txt")

        with open(img_file, "wb") as f:
            f.write(img_bytes)

        with open(label_file, "w") as f:
            f.write("\n".join(labels))

        if progress_callback:
            progress_callback(i + 1, total)

    classes_path = os.path.join(output_dir, "classes.txt")
    with open(classes_path, "w") as f:
        for i, cat in enumerate(categories):
            f.write(f"{i} {cat}\n")

    return total
