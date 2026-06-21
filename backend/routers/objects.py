import uuid
import time
import os
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, Response
from database import get_db
from models import ObjectInfo, ThresholdParams, MaskData
from services.image_processor import (
    read_image_bytes, detect_contours, extract_object,
    trim_transparent_bytes, make_thumbnail, img_to_base64,
    OBJECTS_DIR,
)

router = APIRouter(prefix="/api/objects", tags=["objects"])


def obj_to_info(row) -> ObjectInfo:
    obj_id = row["id"]
    return ObjectInfo(
        id=obj_id,
        name=row["name"],
        category=row["category"] or "",
        thumbnail_url=f"/api/objects/{obj_id}/thumbnail",
        original_url=f"/api/objects/{obj_id}/original",
        cutout_url=f"/api/objects/{obj_id}/cutout",
        created_at=row["created_at"],
        usage_count=row["usage_count"],
    )


@router.post("/upload")
async def upload_object(
    file: UploadFile = File(...),
    name: str = Form(""),
    category: str = Form(""),
    threshold: int = Form(128),
    invert: bool = Form(True),
):
    data = await file.read()
    img = read_image_bytes(data)
    if img is None:
        raise HTTPException(400, "Invalid image")

    obj_id = uuid.uuid4().hex
    obj_dir = os.path.join(OBJECTS_DIR, obj_id)
    os.makedirs(obj_dir, exist_ok=True)

    obj_name = name or os.path.splitext(file.filename or "unnamed")[0]
    original_path = os.path.join(obj_dir, "original.jpg")
    cv2 = __import__("cv2")
    cv2.imwrite(original_path, img)

    result = detect_contours(img, threshold, invert)

    thumbnail_bytes = make_thumbnail(original_path)
    thumbnail_path = os.path.join(obj_dir, "thumbnail.png")
    with open(thumbnail_path, "wb") as f:
        f.write(thumbnail_bytes)

    conn = get_db()
    conn.execute(
        "INSERT INTO objects (id, name, category, original_path, thumbnail_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (obj_id, obj_name, category, original_path, thumbnail_path, time.time()),
    )
    conn.commit()
    conn.close()

    return {
        "object": {
            "id": obj_id,
            "name": obj_name,
            "category": category,
            "thumbnail_url": f"/api/objects/{obj_id}/thumbnail",
            "original_url": f"/api/objects/{obj_id}/original",
            "cutout_url": "",
            "created_at": time.time(),
            "usage_count": 0,
        },
        "detection": result,
    }


@router.get("")
def list_objects():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM objects ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return {"objects": [obj_to_info(r).model_dump() for r in rows]}


@router.get("/{obj_id}/original")
def get_object_original(obj_id: str):
    conn = get_db()
    row = conn.execute("SELECT original_path FROM objects WHERE id = ?", (obj_id,)).fetchone()
    conn.close()
    if not row or not os.path.exists(row["original_path"]):
        raise HTTPException(404, "Not found")
    return FileResponse(row["original_path"])


@router.get("/{obj_id}/thumbnail")
def get_object_thumbnail(obj_id: str):
    conn = get_db()
    row = conn.execute("SELECT thumbnail_path FROM objects WHERE id = ?", (obj_id,)).fetchone()
    conn.close()
    if not row or not row["thumbnail_path"] or not os.path.exists(row["thumbnail_path"]):
        raise HTTPException(404, "Not found")
    return FileResponse(row["thumbnail_path"])


@router.get("/{obj_id}/cutout")
def get_object_cutout(obj_id: str):
    conn = get_db()
    row = conn.execute("SELECT cutout_path FROM objects WHERE id = ?", (obj_id,)).fetchone()
    conn.close()
    if not row or not row["cutout_path"] or not os.path.exists(row["cutout_path"]):
        raise HTTPException(404, "Not found")
    return FileResponse(row["cutout_path"])


@router.put("/{obj_id}")
def update_object(obj_id: str, name: str = Form(""), category: str = Form("")):
    conn = get_db()
    conn.execute(
        "UPDATE objects SET name = ?, category = ? WHERE id = ?",
        (name, category, obj_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/{obj_id}")
def delete_object(obj_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM objects WHERE id = ?", (obj_id,)).fetchone()
    if row:
        obj_dir = os.path.dirname(row["original_path"])
        import shutil
        shutil.rmtree(obj_dir, ignore_errors=True)
    conn.execute("DELETE FROM objects WHERE id = ?", (obj_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/{obj_id}/detect")
def redetect_object(obj_id: str, params: ThresholdParams):
    conn = get_db()
    row = conn.execute("SELECT original_path FROM objects WHERE id = ?", (obj_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Object not found")

    img = __import__("cv2").imread(row["original_path"])
    result = detect_contours(img, params.threshold, params.invert)
    return result


@router.post("/{obj_id}/extract")
def extract_object_mask(obj_id: str, data: MaskData):
    conn = get_db()
    row = conn.execute("SELECT original_path FROM objects WHERE id = ?", (obj_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Object not found")

    cutout_bytes = extract_object(row["original_path"], data.mask_base64)
    trimmed_bytes = trim_transparent_bytes(cutout_bytes)

    obj_dir = os.path.dirname(row["original_path"])
    cutout_path = os.path.join(obj_dir, "cutout.png")
    with open(cutout_path, "wb") as f:
        f.write(trimmed_bytes)

    # Update thumbnail
    thumbnail_bytes = make_thumbnail(cutout_path)
    thumbnail_path = os.path.join(obj_dir, "thumbnail.png")
    with open(thumbnail_path, "wb") as f:
        f.write(thumbnail_bytes)

    conn = get_db()
    conn.execute(
        "UPDATE objects SET cutout_path = ?, thumbnail_path = ? WHERE id = ?",
        (cutout_path, thumbnail_path, obj_id),
    )
    conn.commit()
    conn.close()

    return {"cutout_url": f"/api/objects/{obj_id}/cutout", "ok": True}
