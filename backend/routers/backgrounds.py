import uuid
import time
import os
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from database import get_db
from models import BackgroundInfo
from services.image_processor import BACKGROUNDS_DIR

router = APIRouter(prefix="/api/backgrounds", tags=["backgrounds"])


@router.post("/upload")
async def upload_background(file: UploadFile = File(...)):
    data = await file.read()
    img = __import__("cv2").imdecode(
        __import__("numpy").frombuffer(data, __import__("numpy").uint8),
        __import__("cv2").IMREAD_COLOR,
    )
    if img is None:
        raise HTTPException(400, "Invalid image")

    bg_id = uuid.uuid4().hex
    bg_dir = os.path.join(BACKGROUNDS_DIR, bg_id)
    os.makedirs(bg_dir, exist_ok=True)

    bg_name = os.path.splitext(file.filename or "unnamed")[0]
    image_path = os.path.join(bg_dir, "image.jpg")
    cv2 = __import__("cv2")
    cv2.imwrite(image_path, img)

    conn = get_db()
    conn.execute(
        "INSERT INTO backgrounds (id, name, image_path, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (bg_id, bg_name, image_path, img.shape[1], img.shape[0], time.time()),
    )
    conn.commit()
    conn.close()

    return {
        "background": {
            "id": bg_id,
            "name": bg_name,
            "image_url": f"/api/backgrounds/{bg_id}/image",
            "width": img.shape[1],
            "height": img.shape[0],
            "created_at": time.time(),
        }
    }


@router.get("")
def list_backgrounds():
    conn = get_db()
    rows = conn.execute("SELECT * FROM backgrounds ORDER BY created_at DESC").fetchall()
    conn.close()
    return {
        "backgrounds": [
            {
                "id": r["id"],
                "name": r["name"],
                "image_url": f"/api/backgrounds/{r['id']}/image",
                "width": r["width"],
                "height": r["height"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


@router.get("/{bg_id}/image")
def get_background_image(bg_id: str):
    conn = get_db()
    row = conn.execute("SELECT image_path FROM backgrounds WHERE id = ?", (bg_id,)).fetchone()
    conn.close()
    if not row or not os.path.exists(row["image_path"]):
        raise HTTPException(404, "Not found")
    return FileResponse(row["image_path"])


@router.delete("/{bg_id}")
def delete_background(bg_id: str):
    conn = get_db()
    row = conn.execute("SELECT image_path FROM backgrounds WHERE id = ?", (bg_id,)).fetchone()
    if row:
        bg_dir = os.path.dirname(row["image_path"])
        import shutil
        shutil.rmtree(bg_dir, ignore_errors=True)
    conn.execute("DELETE FROM backgrounds WHERE id = ?", (bg_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
