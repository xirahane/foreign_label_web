import type { GenerationParams } from '@/types'

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

export function generatePlacement(
  canvasWidth: number,
  canvasHeight: number,
  objectWidth: number,
  objectHeight: number,
  params: GenerationParams,
  boundary?: { x: number; y: number; width: number; height: number } | null
): RandomPlacement {
  const scale = randomInRange(params.scaleMin, params.scaleMax) / 100
  const w = objectWidth * scale
  const h = objectHeight * scale

  const edgeMargin = params.edgeMargin || 20

  let bx = edgeMargin
  let by = edgeMargin
  let bw = canvasWidth - edgeMargin * 2
  let bh = canvasHeight - edgeMargin * 2

  if (boundary) {
    bx = boundary.x + edgeMargin
    by = boundary.y + edgeMargin
    bw = boundary.width - edgeMargin * 2
    bh = boundary.height - edgeMargin * 2
  }

  const minX = Math.min(bx, bx + bw - w)
  const minY = Math.min(by, by + bh - h)
  const maxX = Math.max(bx, bx + bw - w)
  const maxY = Math.max(by, by + bh - h)

  const x = minX >= maxX ? minX : randomInRange(minX, maxX)
  const y = minY >= maxY ? minY : randomInRange(minY, maxY)

  const rotation = randomInRange(params.rotationMin, params.rotationMax)
  const opacity = params.opacityVariance ? randomInRange(0.6, 1.0) : 1.0

  return { x, y, width: w, height: h, rotation, scale, opacity }
}
