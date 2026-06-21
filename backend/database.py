import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "storage", "app.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS objects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT DEFAULT '',
            original_path TEXT NOT NULL,
            mask_path TEXT DEFAULT '',
            cutout_path TEXT DEFAULT '',
            thumbnail_path TEXT DEFAULT '',
            created_at REAL NOT NULL,
            usage_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS backgrounds (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            image_path TEXT NOT NULL,
            width INTEGER DEFAULT 0,
            height INTEGER DEFAULT 0,
            created_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS datasets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category_count INTEGER DEFAULT 0,
            output_format TEXT DEFAULT 'yolov8',
            image_width INTEGER DEFAULT 640,
            image_height INTEGER DEFAULT 640,
            created_at REAL NOT NULL,
            generated_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS samples (
            id TEXT PRIMARY KEY,
            dataset_id TEXT NOT NULL,
            image_path TEXT NOT NULL,
            label_path TEXT NOT NULL,
            generated_at REAL NOT NULL,
            FOREIGN KEY (dataset_id) REFERENCES datasets(id)
        );
    """)
    conn.commit()
    conn.close()
