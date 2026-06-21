import cv2
import numpy as np
import os
import base64
from io import BytesIO
from PIL import Image

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "storage")
OBJECTS_DIR = os.path.join(STORAGE_DIR, "objects")
BACKGROUNDS_DIR = os.path.join(STORAGE_DIR, "backgrounds")
DATASETS_DIR = os.path.join(STORAGE_DIR, "datasets")


def ensure_dirs():
    os.makedirs(OBJECTS_DIR, exist_ok=True)
    os.makedirs(BACKGROUNDS_DIR, exist_ok=True)
    os.makedirs(DATASETS_DIR, exist_ok=True)


def read_image_bytes(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def read_image(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return img


def img_to_base64(img: np.ndarray, fmt: str = ".png") -> str:
    _, buf = cv2.imencode(fmt, img)
    return base64.b64encode(buf).decode("utf-8")


def img_to_bytes(img: np.ndarray, fmt: str = ".png") -> bytes:
    _, buf = cv2.imencode(fmt, img)
    return buf.tobytes()


def pil_to_cv2(pil_img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def cv2_to_pil(img: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def load_image_pil(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def detect_contours(
    img: np.ndarray,
    threshold: int = 128,
    invert: bool = True,
) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if invert:
        _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)
    else:
        _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    contours_info = []
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(closed, connectivity=4)

    img_area = img.shape[0] * img.shape[1]
    min_area = img_area * 0.005

    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        x = stats[i, cv2.CC_STAT_LEFT]
        y = stats[i, cv2.CC_STAT_TOP]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        ratio = max(w / img.shape[1], h / img.shape[0])

        if area >= min_area and ratio >= 0.1:
            expand = 8
            contours_info.append({
                "x": max(0, x - expand),
                "y": max(0, y - expand),
                "width": min(img.shape[1], w + expand * 2),
                "height": min(img.shape[0], h + expand * 2),
            })

    contours_info.sort(key=lambda c: c["width"] * c["height"], reverse=True)

    return {
        "contours": contours_info,
        "mask_base64": img_to_base64(closed),
    }


def extract_object(original_path: str, mask_data_uri: str) -> bytes:
    """
    Apply mask (base64) to original image and return cutout PNG bytes.
    """
    original = cv2.imread(original_path, cv2.IMREAD_COLOR)
    if original is None:
        raise FileNotFoundError(f"Original not found: {original_path}")

    if "," in mask_data_uri:
        mask_data_uri = mask_data_uri.split(",", 1)[1]

    mask_bytes = base64.b64decode(mask_data_uri)
    mask_arr = np.frombuffer(mask_bytes, np.uint8)
    mask = cv2.imdecode(mask_arr, cv2.IMREAD_GRAYSCALE)

    if mask is None:
        raise ValueError("Invalid mask data")

    if mask.shape[:2] != original.shape[:2]:
        mask = cv2.resize(mask, (original.shape[1], original.shape[0]))

    original_rgba = cv2.cvtColor(original, cv2.COLOR_BGR2BGRA)
    original_rgba[:, :, 3] = mask

    _, cutout_bytes = cv2.imencode(".png", original_rgba)
    return cutout_bytes.tobytes()


def trim_transparent_bytes(png_bytes: bytes) -> bytes:
    """Trim transparent borders and return PNG bytes."""
    arr = np.frombuffer(png_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)

    if img is None or img.shape[2] < 4:
        return png_bytes

    alpha = img[:, :, 3]
    coords = cv2.findNonZero(alpha)
    if coords is None:
        return png_bytes

    x, y, w, h = cv2.boundingRect(coords)
    cropped = img[y:y + h, x:x + w]

    _, result = cv2.imencode(".png", cropped)
    return result.tobytes()


def make_thumbnail(img_path: str, size: int = 64) -> bytes:
    """Create thumbnail PNG bytes."""
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Image not found: {img_path}")

    h, w = img.shape[:2]
    scale = min(size / w, size / h)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(img, (new_w, new_h))

    channels = img.shape[2] if len(img.shape) > 2 else 1
    x_offset = (size - new_w) // 2
    y_offset = (size - new_h) // 2

    if channels == 4:
        thumbnail = np.zeros((size, size, 4), dtype=np.uint8)
        thumbnail[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized
    else:
        thumbnail = np.zeros((size, size, 3), dtype=np.uint8)
        if len(resized.shape) == 2:
            resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
        thumbnail[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized

    _, result = cv2.imencode(".png", thumbnail)
    return result.tobytes()
