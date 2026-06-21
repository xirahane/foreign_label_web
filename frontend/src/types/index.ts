export interface ForeignObject {
  id: string
  name: string
  category: string
  thumbnail: string
  originalImage: string
  maskData: string
  cutoutImage: string
  createdAt: number
  usageCount: number
  yoloBoxes?: YOLOBoxRaw[]
  cropRect?: CropRect
}

export interface BackgroundImage {
  id: string
  name: string
  dataUrl: string
  width: number
  height: number
  createdAt: number
  yoloBoxes?: YOLOBoxRaw[]
  cropRect?: CropRect
}

export interface YOLOBoxRaw {
  classId: number
  centerX: number
  centerY: number
  width: number
  height: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type ExportFormat = 'yolov5' | 'yolov8' | 'coco'

export interface Dataset {
  id: string
  name: string
  categoryCount: number
  outputFormat: ExportFormat
  imageSize: { width: number; height: number }
  createdAt: number
  generatedImages: number
  labelCount: number
}

export interface DatasetSample {
  id: string
  datasetId: string
  imageData: string
  annotations: YOLOAnnotation[]
  generatedAt: number
}

export interface YOLOAnnotation {
  classId: number
  centerX: number
  centerY: number
  width: number
  height: number
}

export interface GenerationParams {
  objectCountMin: number
  objectCountMax: number
  scaleMin: number
  scaleMax: number
  rotationMin: number
  rotationMax: number
  opacityVariance: boolean
  blurVariance: boolean
  brightnessVariance: boolean
  contrastVariance: boolean
  edgeBlendStrength: number
  blendMode: BlendMode
  bboxStrategy: 'tight' | 'expand'
  bboxExpandRatio: number
  perClassStrategies: Record<string, { bboxStrategy: 'tight' | 'expand'; bboxExpandRatio: number }>
  totalCount: number
  namingRule: string
  exportFormat: ExportFormat
  edgeMargin: number
}

export interface CanvasObject {
  id: string
  foreignObjectId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
  imageData: string
}

export interface PolygonPoint {
  x: number
  y: number
}

export type Step = 'library' | 'config' | 'generator' | 'management'
export type BlendMode = 'feather' | 'poisson' | 'direct'
export type BBoxStrategy = 'tight' | 'expand'
