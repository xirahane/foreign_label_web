import zipfile
import os
import io


def create_export_zip(dataset_dir: str) -> bytes:
    """Create a ZIP file from a dataset directory."""
    buf = io.BytesIO()
    dataset_name = os.path.basename(dataset_dir)

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(dataset_dir):
            for file in files:
                full_path = os.path.join(root, file)
                arcname = os.path.join(dataset_name, os.path.relpath(full_path, dataset_dir))
                zf.write(full_path, arcname)

    buf.seek(0)
    return buf.read()
