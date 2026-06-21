import uuid
import time
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from database import get_db
from models import DatasetInfo, DatasetCreate
from services.exporter import create_export_zip
from services.image_processor import DATASETS_DIR

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.post("")
def create_dataset(data: DatasetCreate):
    ds_id = uuid.uuid4().hex
    conn = get_db()
    conn.execute(
        "INSERT INTO datasets (id, name, output_format, image_width, image_height, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (ds_id, data.name, data.output_format, data.image_width, data.image_height, time.time()),
    )
    conn.commit()
    conn.close()
    return {"id": ds_id, "name": data.name}


@router.get("")
def list_datasets():
    conn = get_db()
    rows = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC").fetchall()
    conn.close()
    return {
        "datasets": [
            {
                "id": r["id"],
                "name": r["name"],
                "category_count": r["category_count"],
                "output_format": r["output_format"],
                "image_width": r["image_width"],
                "image_height": r["image_height"],
                "created_at": r["created_at"],
                "generated_count": r["generated_count"],
            }
            for r in rows
        ]
    }


@router.delete("/{ds_id}")
def delete_dataset(ds_id: str):
    conn = get_db()
    conn.execute("DELETE FROM samples WHERE dataset_id = ?", (ds_id,))
    conn.execute("DELETE FROM datasets WHERE id = ?", (ds_id,))
    conn.commit()
    conn.close()

    ds_dir = os.path.join(DATASETS_DIR, ds_id)
    import shutil
    shutil.rmtree(ds_dir, ignore_errors=True)
    return {"ok": True}


@router.get("/{ds_id}/samples")
def list_samples(ds_id: str):
    conn = get_db()
    samples = conn.execute(
        "SELECT * FROM samples WHERE dataset_id = ? ORDER BY generated_at",
        (ds_id,),
    ).fetchall()
    conn.close()
    return {
        "samples": [
            {
                "id": s["id"],
                "dataset_id": s["dataset_id"],
                "image_url": f"/api/datasets/{ds_id}/samples/{os.path.basename(s['image_path'])}/image",
                "label_url": f"/api/datasets/{ds_id}/samples/{os.path.basename(s['label_path'])}/label",
                "generated_at": s["generated_at"],
            }
            for s in samples
        ]
    }


@router.get("/{ds_id}/samples/{filename}/image")
def get_sample_image(ds_id: str, filename: str):
    path = os.path.join(DATASETS_DIR, ds_id, "images", filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/{ds_id}/samples/{filename}/label")
def get_sample_label(ds_id: str, filename: str):
    path = os.path.join(DATASETS_DIR, ds_id, "labels", filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="text/plain")


@router.delete("/{ds_id}/samples/{sample_id}")
def delete_sample(ds_id: str, sample_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM samples WHERE id = ? AND dataset_id = ?", (sample_id, ds_id)).fetchone()
    if row:
        if os.path.exists(row["image_path"]):
            os.remove(row["image_path"])
        if os.path.exists(row["label_path"]):
            os.remove(row["label_path"])
    conn.execute("DELETE FROM samples WHERE id = ?", (sample_id,))
    count = conn.execute("SELECT COUNT(*) as cnt FROM samples WHERE dataset_id = ?", (ds_id,)).fetchone()["cnt"]
    conn.execute("UPDATE datasets SET generated_count = ? WHERE id = ?", (count, ds_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/{ds_id}/export")
def export_dataset(ds_id: str):
    ds_dir = os.path.join(DATASETS_DIR, ds_id)
    zip_data = create_export_zip(ds_dir)
    conn = get_db()
    ds = conn.execute("SELECT name FROM datasets WHERE id = ?", (ds_id,)).fetchone()
    conn.close()
    name = ds["name"] if ds else "dataset"
    from fastapi.responses import Response
    return Response(
        content=zip_data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'},
    )
