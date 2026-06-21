from pydantic import BaseModel, Field
from typing import Optional, List
import time


class ObjectInfo(BaseModel):
    id: str
    name: str
    category: str = ""
    thumbnail_url: str = ""
    original_url: str = ""
    cutout_url: str = ""
    created_at: float = Field(default_factory=time.time)
    usage_count: int = 0


class ObjectCreate(BaseModel):
    name: str = ""
    category: str = ""


class BackgroundInfo(BaseModel):
    id: str
    name: str
    image_url: str
    width: int = 0
    height: int = 0
    created_at: float = Field(default_factory=time.time)


class DatasetInfo(BaseModel):
    id: str
    name: str
    category_count: int = 0
    output_format: str = "yolov8"
    image_width: int = 640
    image_height: int = 640
    created_at: float = Field(default_factory=time.time)
    generated_count: int = 0


class DatasetCreate(BaseModel):
    name: str
    output_format: str = "yolov8"
    image_width: int = 640
    image_height: int = 640


class SampleInfo(BaseModel):
    id: str
    dataset_id: str
    image_url: str
    label_url: str
    generated_at: float


class GenerateParams(BaseModel):
    dataset_id: str
    background_id: str
    object_ids: List[str] = []
    object_count_min: int = 1
    object_count_max: int = 5
    scale_min: int = 50
    scale_max: int = 150
    rotation_min: int = 0
    rotation_max: int = 360
    opacity_variance: bool = False
    edge_blend: int = 50
    blend_mode: str = "feather"
    bbox_strategy: str = "tight"
    bbox_expand: int = 10
    edge_margin: int = 20
    total_count: int = 10


class ThresholdParams(BaseModel):
    threshold: int = 128
    invert: bool = True


class MaskData(BaseModel):
    id: str
    mask_base64: str
