import type { GenerationParams, PolygonPoint } from '@/types'

export function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

export function randomIntInRange(min: number, max: number): number {
  return Math.floor(randomInRange(min, max + 1))
}

export function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export interface RandomPlacement {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scale: number
  opacity: number
}

function pointInPolygon(px: number, py: number, polygon: PolygonPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function generatePlacement(
  canvasWidth: number,
  canvasHeight: number,
  objectWidth: number,
  objectHeight: number,
  params: GenerationParams,
  boundary?: { x: number; y: number; width: number; height: number } | null,
  polygon?: PolygonPoint[] | null
): RandomPlacement {
  const scale = randomInRange(params.scaleMin, params.scaleMax) / 100
  const w = objectWidth * scale
  const h = objectHeight * scale

  const edgeMargin = params.edgeMargin || 20

  let bx = edgeMargin
  let by = edgeMargin
  let bw = canvasWidth - edgeMargin * 2
  let bh = canvasHeight - edgeMargin * 2

  if (boundary && !polygon) {
    bx = boundary.x + edgeMargin
    by = boundary.y + edgeMargin
    bw = boundary.width - edgeMargin * 2
    bh = boundary.height - edgeMargin * 2
  }

  const rotation = randomInRange(params.rotationMin, params.rotationMax)
  const opacity = params.opacityVariance ? randomInRange(0.6, 1.0) : 1.0

  if (polygon && polygon.length >= 3) {
    const polygonBounds = {
      x: Math.min(...polygon.map((p) => p.x)),
      y: Math.min(...polygon.map((p) => p.y)),
      width: Math.max(...polygon.map((p) => p.x)) - Math.min(...polygon.map((p) => p.x)),
      height: Math.max(...polygon.map((p) => p.y)) - Math.min(...polygon.map((p) => p.y)),
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const x = randomInRange(polygonBounds.x + edgeMargin, polygonBounds.x + polygonBounds.width - edgeMargin - w)
      const y = randomInRange(polygonBounds.y + edgeMargin, polygonBounds.y + polygonBounds.height - edgeMargin - h)
      const corners = [
        { x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h },
      ]
      if (corners.every((c) => pointInPolygon(c.x, c.y, polygon))) {
        return { x, y, width: w, height: h, rotation, scale, opacity }
      }
    }

    const centerX = polygonBounds.x + polygonBounds.width / 2 - w / 2
    const centerY = polygonBounds.y + polygonBounds.height / 2 - h / 2
    return { x: centerX, y: centerY, width: w, height: h, rotation, scale, opacity }
  }

  const minX = Math.min(bx, bx + bw - w)
  const minY = Math.min(by, by + bh - h)
  const maxX = Math.max(bx, bx + bw - w)
  const maxY = Math.max(by, by + bh - h)

  const x = minX >= maxX ? minX : randomInRange(minX, maxX)
  const y = minY >= maxY ? minY : randomInRange(minY, maxY)

  return { x, y, width: w, height: h, rotation, scale, opacity }
}
