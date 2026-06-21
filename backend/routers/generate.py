import uuid
import os
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from models import GenerateParams
from services.generator import compose_image
from services.image_processor import DATASETS_DIR

router = APIRouter(prefix="/api/generate", tags=["generate"])


@router.post("/preview")
def preview_generate(params: GenerateParams):
    """Generate a single preview image and return it as base64."""
    conn = get_db()

    bg_row = conn.execute("SELECT image_path FROM backgrounds WHERE id = ?", (params.background_id,)).fetchone()
    if not bg_row:
        conn.close()
        raise HTTPException(404, "Background not found")

    obj_rows = conn.execute("SELECT id, cutout_path, category FROM objects WHERE cutout_path != ''").fetchall()
    if params.object_ids:
        obj_rows = [r for r in obj_rows if r["id"] in params.object_ids]
    conn.close()

    if not obj_rows:
        raise HTTPException(400, "No objects with cutout images")

    import random
    random.shuffle(obj_rows)

    categories = list(set(r["category"] for r in obj_rows if r["category"]))
    class_ids = {r["cutout_path"]: categories.index(r["category"]) if r["category"] in categories else 0 for r in obj_rows}

    img_bytes, labels = compose_image(
        bg_row["image_path"],
        [r["cutout_path"] for r in obj_rows],
        {
            "object_count_min": params.object_count_min,
            "object_count_max": params.object_count_max,
            "scale_min": params.scale_min,
            "scale_max": params.scale_max,
            "rotation_min": params.rotation_min,
            "rotation_max": params.rotation_max,
            "edge_blend": params.edge_blend,
            "edge_margin": params.edge_margin,
            "bbox_strategy": params.bbox_strategy,
            "bbox_expand": params.bbox_expand,
        },
        class_ids,
    )

    import base64
    return {
        "image_base64": base64.b64encode(img_bytes).decode("utf-8"),
        "labels": labels,
    }


@router.post("/batch")
def batch_generate(params: GenerateParams):
    conn = get_db()

    bg_row = conn.execute("SELECT image_path, width, height FROM backgrounds WHERE id = ?", (params.background_id,)).fetchone()
    if not bg_row:
        conn.close()
        raise HTTPException(404, "Background not found")

    obj_rows = conn.execute("SELECT id, cutout_path, category FROM objects WHERE cutout_path != ''").fetchall()
    if params.object_ids:
        obj_rows = [r for r in obj_rows if r["id"] in params.object_ids]
    conn.close()

    if not obj_rows:
        raise HTTPException(400, "No objects with cutout images")

    categories = list(set(r["category"] for r in obj_rows if r["category"]))
    class_ids = {r["cutout_path"]: categories.index(r["category"]) if r["category"] in categories else 0 for r in obj_rows}

    ds_dir = os.path.join(DATASETS_DIR, params.dataset_id)
    os.makedirs(os.path.join(ds_dir, "images"), exist_ok=True)
    os.makedirs(os.path.join(ds_dir, "labels"), exist_ok=True)

    conn2 = get_db()
    conn2.execute("UPDATE datasets SET category_count = ? WHERE id = ?", (len(categories), params.dataset_id))
    conn2.commit()

    import random
    total = params.total_count

    for i in range(total):
        random.shuffle(obj_rows)
        img_bytes, labels = compose_image(
            bg_row["image_path"],
            [r["cutout_path"] for r in obj_rows],
            {
                "object_count_min": params.object_count_min,
                "object_count_max": params.object_count_max,
                "scale_min": params.scale_min,
                "scale_max": params.scale_max,
                "rotation_min": params.rotation_min,
                "rotation_max": params.rotation_max,
                "edge_blend": params.edge_blend,
                "edge_margin": params.edge_margin,
                "bbox_strategy": params.bbox_strategy,
                "bbox_expand": params.bbox_expand,
            },
            class_ids,
        )

        idx_str = str(i + 1).zfill(4)
        img_path = os.path.join(ds_dir, "images", f"{idx_str}.jpg")
        label_path = os.path.join(ds_dir, "labels", f"{idx_str}.txt")

        with open(img_path, "wb") as f:
            f.write(img_bytes)
        with open(label_path, "w") as f:
            f.write("\n".join(labels))

        sample_id = uuid.uuid4().hex
        conn2.execute(
            "INSERT INTO samples (id, dataset_id, image_path, label_path, generated_at) VALUES (?, ?, ?, ?, ?)",
            (sample_id, params.dataset_id, img_path, label_path, time.time()),
        )

        conn2.execute(
            "UPDATE datasets SET generated_count = ? WHERE id = ?",
            (i + 1, params.dataset_id),
        )

        # Increment usage
        for r in obj_rows:
            conn2.execute("UPDATE objects SET usage_count = usage_count + 1 WHERE id = ?", (r["id"],))

    classes_path = os.path.join(ds_dir, "classes.txt")
    with open(classes_path, "w") as f:
        for i, cat in enumerate(categories):
            f.write(f"{i} {cat}\n")

    conn2.commit()
    conn2.close()

    return {"generated": total, "ok": True}
