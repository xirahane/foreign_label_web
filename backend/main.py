import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager

from database import init_db
from routers import objects, backgrounds, datasets, generate

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI异物数据集生成平台", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"[ERROR] {request.method} {request.url.path}", file=sys.stderr)
    print(f"[ERROR] {exc}", file=sys.stderr)
    print(f"[ERROR] {tb}", file=sys.stderr)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": tb},
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(objects.router)
app.include_router(backgrounds.router)
app.include_router(datasets.router)
app.include_router(generate.router)


if os.path.exists(FRONTEND_DIST):
    MIME_TYPES = {
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
    }

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            ext = os.path.splitext(file_path)[1].lower()
            media_type = MIME_TYPES.get(ext, "application/octet-stream")
            return FileResponse(file_path, media_type=media_type)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"), media_type="text/html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
