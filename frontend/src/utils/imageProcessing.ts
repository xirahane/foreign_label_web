import type { YOLOBoxRaw, CropRect, PolygonPoint } from '@/types'

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function parseYOLOTxt(text: string): YOLOBoxRaw[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s+/)
      if (parts.length >= 5) {
        return {
          classId: parseInt(parts[0], 10),
          centerX: parseFloat(parts[1]),
          centerY: parseFloat(parts[2]),
          width: parseFloat(parts[3]),
          height: parseFloat(parts[4]),
        }
      }
      return null
    })
    .filter(Boolean) as YOLOBoxRaw[]
}

export function adjustYOLOBoxesForCrop(
  boxes: YOLOBoxRaw[],
  crop: CropRect,
  imgW: number,
  imgH: number
): YOLOBoxRaw[] {
  return boxes.map((box) => {
    const absX = box.centerX * imgW
    const absY = box.centerY * imgH
    const absW = box.width * imgW
    const absH = box.height * imgH

    const newX = absX - crop.x
    const newY = absY - crop.y

    return {
      classId: box.classId,
      centerX: newX / crop.width,
      centerY: newY / crop.height,
      width: absW / crop.width,
      height: absH / crop.height,
    }
  })
}

export function drawYOLOBoxes(
  ctx: CanvasRenderingContext2D,
  boxes: YOLOBoxRaw[],
  drawX: number,
  drawY: number,
  drawW: number,
  drawH: number
) {
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'
  ctx.lineWidth = 2
  ctx.setLineDash([4, 2])
  for (const box of boxes) {
    const bx = drawX + box.centerX * drawW - (box.width * drawW) / 2
    const by = drawY + box.centerY * drawH - (box.height * drawH) / 2
    const bw = box.width * drawW
    const bh = box.height * drawH
    ctx.strokeRect(bx, by, bw, bh)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
    ctx.fillRect(bx, by, bw, bh)
  }
  ctx.setLineDash([])
}

export function cropImageToRect(
  img: HTMLImageElement,
  crop: CropRect
): { dataUrl: string; croppedImg: HTMLImageElement } {
  const canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, crop.width, crop.height)
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
  return { dataUrl, croppedImg: canvas as unknown as HTMLImageElement }
}

export function cropImageToDataUrl(
  dataUrl: string,
  crop: CropRect
): Promise<{ dataUrl: string; width: number; height: number }> {
  return loadImage(dataUrl).then((img) => {
    const result = cropImageToRect(img, crop)
    return { dataUrl: result.dataUrl, width: crop.width, height: crop.height }
  })
}

export function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx }
}

export function applyMask(
  sourceImage: HTMLImageElement,
  maskCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(sourceImage.width, sourceImage.height)
  ctx.drawImage(sourceImage, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const maskCtx = maskCanvas.getContext('2d')!
  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)

  const scaleX = maskCanvas.width / canvas.width
  const scaleY = maskCanvas.height / canvas.height

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const mx = Math.floor(x * scaleX)
      const my = Math.floor(y * scaleY)
      const maskIdx = (my * maskCanvas.width + mx) * 4
      const alpha = maskData.data[maskIdx + 3] / 255
      const idx = (y * canvas.width + x) * 4
      imageData.data[idx + 3] = Math.round(imageData.data[idx + 3] * alpha)
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export interface ContourResult {
  contours: { x: number; y: number; width: number; height: number }[]
  maskCanvas: HTMLCanvasElement
}

function morphologyClose(
  imageData: ImageData,
  kernelSize: number
): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)
  result.data.set(data)

  const halfK = Math.floor(kernelSize / 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0
      for (let ky = -halfK; ky <= halfK; ky++) {
        for (let kx = -halfK; kx <= halfK; kx++) {
          const nx = x + kx
          const ny = y + ky
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const val = data[(ny * width + nx) * 4]
            if (val > maxVal) maxVal = val
          }
        }
      }
      const idx = (y * width + x) * 4
      result.data[idx] = maxVal
      result.data[idx + 1] = maxVal
      result.data[idx + 2] = maxVal
      result.data[idx + 3] = maxVal
    }
  }

  const eroded = new ImageData(width, height)
  eroded.data.set(result.data)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255
      for (let ky = -halfK; ky <= halfK; ky++) {
        for (let kx = -halfK; kx <= halfK; kx++) {
          const nx = x + kx
          const ny = y + ky
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const val = result.data[(ny * width + nx) * 4]
            if (val < minVal) minVal = val
          }
        }
      }
      const idx = (y * width + x) * 4
      eroded.data[idx] = minVal
      eroded.data[idx + 1] = minVal
      eroded.data[idx + 2] = minVal
      eroded.data[idx + 3] = minVal
    }
  }

  return eroded
}

export function detectContoursByThreshold(
  img: HTMLImageElement,
  threshold: number = 128,
  invert: boolean = true
): ContourResult {
  const { canvas, ctx } = createCanvas(img.width, img.height)
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data, width, height } = imageData

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = width
  maskCanvas.height = height
  const maskCtx = maskCanvas.getContext('2d')!
  const maskImageData = maskCtx.createImageData(width, height)

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    let value = invert
      ? (gray < threshold ? 255 : 0)
      : (gray > threshold ? 255 : 0)
    maskImageData.data[i] = value
    maskImageData.data[i + 1] = value
    maskImageData.data[i + 2] = value
    maskImageData.data[i + 3] = value
  }

  const closed = morphologyClose(maskImageData, Math.max(3, Math.round(Math.min(width, height) * 0.005)))

  maskCtx.putImageData(closed, 0, 0)

  const visited = new Uint8Array(width * height)
  const contours: { x: number; y: number; width: number; height: number }[] = []
  const minArea = (width * height) * 0.005

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const pixelIdx = idx * 4
      if (closed.data[pixelIdx] > 128 && !visited[idx]) {
        let minX = x, maxX = x, minY = y, maxY = y
        const stack: [number, number][] = [[x, y]]
        visited[idx] = 1

        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!
          if (cx < minX) minX = cx
          if (cx > maxX) maxX = cx
          if (cy < minY) minY = cy
          if (cy > maxY) maxY = cy

          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx
              const npidx = nidx * 4
              if (closed.data[npidx] > 128 && !visited[nidx]) {
                visited[nidx] = 1
                stack.push([nx, ny])
              }
            }
          }
        }

        const contourW = maxX - minX + 1
        const contourH = maxY - minY + 1
        const ratio = Math.max(contourW / img.width, contourH / img.height)
        if (contourW * contourH >= minArea && ratio >= 0.1) {
          const expand = Math.max(16, Math.round(Math.max(width, height) * 0.1))
          contours.push({
            x: Math.max(0, minX - expand),
            y: Math.max(0, minY - expand),
            width: Math.min(width, contourW + expand * 2),
            height: Math.min(height, contourH + expand * 2),
          })
        }
      }
    }
  }

  contours.sort((a, b) => (b.width * b.height) - (a.width * a.height))

  return { contours, maskCanvas }
}

export function getBagBoundary(
  img: HTMLImageElement,
  threshold: number = 128
): { x: number; y: number; width: number; height: number } | null {
  const result = detectContoursByThreshold(img, threshold, true)
  if (result.contours.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of result.contours) {
    if (c.x < minX) minX = c.x
    if (c.y < minY) minY = c.y
    if (c.x + c.width > maxX) maxX = c.x + c.width
    if (c.y + c.height > maxY) maxY = c.y + c.height
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function morphologyDilate(
  imageData: ImageData,
  kernelSize: number
): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)
  result.data.set(data)
  const halfK = Math.floor(kernelSize / 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0
      for (let ky = -halfK; ky <= halfK; ky++) {
        for (let kx = -halfK; kx <= halfK; kx++) {
          const nx = x + kx, ny = y + ky
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const val = data[(ny * width + nx) * 4]
            if (val > maxVal) maxVal = val
          }
        }
      }
      const idx = (y * width + x) * 4
      result.data[idx] = result.data[idx + 1] = result.data[idx + 2] = result.data[idx + 3] = maxVal
    }
  }
  return result
}

function morphologyErode(
  imageData: ImageData,
  kernelSize: number
): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)
  result.data.set(data)
  const halfK = Math.floor(kernelSize / 2)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255
      for (let ky = -halfK; ky <= halfK; ky++) {
        for (let kx = -halfK; kx <= halfK; kx++) {
          const nx = x + kx, ny = y + ky
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const val = data[(ny * width + nx) * 4]
            if (val < minVal) minVal = val
          }
        }
      }
      const idx = (y * width + x) * 4
      result.data[idx] = result.data[idx + 1] = result.data[idx + 2] = result.data[idx + 3] = minVal
    }
  }
  return result
}

export function detectTiltedBoundary(img: HTMLImageElement): PolygonPoint[] | null {
  const maxDim = 400
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const sw = Math.round(img.width * scale)
  const sh = Math.round(img.height * scale)

  const { canvas, ctx } = createCanvas(sw, sh)
  ctx.drawImage(img, 0, 0, sw, sh)
  const imageData = ctx.getImageData(0, 0, sw, sh)
  const { data, width, height } = imageData

  const hist = new Array(256).fill(0)
  let totalPixels = 0
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
    hist[gray]++
    totalPixels++
  }

  let otsuThreshold = 128
  let maxVariance = 0
  let sumTotal = 0
  for (let i = 0; i < 256; i++) sumTotal += i * hist[i]
  let sumB = 0, wB = 0
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = totalPixels - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumTotal - sumB) / wF
    const variance = wB * wF * (mB - mF) * (mB - mF)
    if (variance > maxVariance) {
      maxVariance = variance
      otsuThreshold = t
    }
  }

  const maskData = new ImageData(width, height)
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    const value = gray < otsuThreshold ? 255 : 0
    maskData.data[i] = maskData.data[i + 1] = maskData.data[i + 2] = value
    maskData.data[i + 3] = value
  }

  const closeRadius = Math.max(5, Math.round(Math.min(width, height) * 0.04))
  let closed = morphologyDilate(maskData, closeRadius)
  closed = morphologyErode(closed, closeRadius)

  const visited = new Uint8Array(width * height)
  const components: { pixels: Array<{ x: number; y: number }> }[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (closed.data[idx * 4] > 128 && !visited[idx]) {
        const pixels: Array<{ x: number; y: number }> = []
        const stack: Array<{ x: number; y: number }> = [{ x, y }]
        visited[idx] = 1
        while (stack.length > 0) {
          const pt = stack.pop()!
          pixels.push(pt)
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = pt.x + dx, ny = pt.y + dy
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx
              if (closed.data[nidx * 4] > 128 && !visited[nidx]) {
                visited[nidx] = 1
                stack.push({ x: nx, y: ny })
              }
            }
          }
        }
        if (pixels.length > 10) {
          components.push({ pixels })
        }
      }
    }
  }

  components.sort((a, b) => b.pixels.length - a.pixels.length)
  if (components.length === 0) return null

  const mainPixels = components[0].pixels
  let whitePixels = mainPixels

  if (whitePixels.length < 10) return null

  let cx = 0, cy = 0
  for (const p of whitePixels) { cx += p.x; cy += p.y }
  cx /= whitePixels.length; cy /= whitePixels.length

  let pxx = 0, pyy = 0, pxy = 0
  for (const p of whitePixels) {
    const dx = p.x - cx, dy = p.y - cy
    pxx += dx * dx; pyy += dy * dy; pxy += dx * dy
  }
  pxx /= whitePixels.length; pyy /= whitePixels.length; pxy /= whitePixels.length

  function computeCorners(angle: number): { corners: PolygonPoint[]; area: number } {
    const cos = Math.cos(angle), sin = Math.sin(angle)
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const p of whitePixels) {
      const dx = p.x - cx, dy = p.y - cy
      const u = dx * cos + dy * sin
      const v = -dx * sin + dy * cos
      if (u < minU) minU = u; if (u > maxU) maxU = u
      if (v < minV) minV = v; if (v > maxV) maxV = v
    }
    const margin = Math.min(maxU - minU, maxV - minV) * 0.02
    minU -= margin; maxU += margin; minV -= margin; maxV += margin
    const area = (maxU - minU) * (maxV - minV)
    const invScaleX = img.width / sw
    const invScaleY = img.height / sh
    const corners: PolygonPoint[] = [
      { x: (cx + minU * cos - minV * sin) * invScaleX, y: (cy + minU * sin + minV * cos) * invScaleY },
      { x: (cx + maxU * cos - minV * sin) * invScaleX, y: (cy + maxU * sin + minV * cos) * invScaleY },
      { x: (cx + maxU * cos - maxV * sin) * invScaleX, y: (cy + maxU * sin + maxV * cos) * invScaleY },
      { x: (cx + minU * cos - maxV * sin) * invScaleX, y: (cy + minU * sin + maxV * cos) * invScaleY },
    ]
    corners.forEach((c) => {
      c.x = Math.max(0, Math.min(img.width, Math.round(c.x)))
      c.y = Math.max(0, Math.min(img.height, Math.round(c.y)))
    })
    return { corners, area }
  }

  const theta0 = 0.5 * Math.atan2(2 * pxy, pxx - pyy)
  const result0 = computeCorners(theta0)
  const result90 = computeCorners(theta0 + Math.PI / 2)

  return result0.area <= result90.area ? result0.corners : result90.corners
}

export function drawContoursOnCanvas(
  sourceCanvas: HTMLCanvasElement,
  contours: { x: number; y: number; width: number; height: number }[],
  color: string = '#3b82f6'
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = sourceCanvas.width
  canvas.height = sourceCanvas.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(sourceCanvas, 0, 0)

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([4, 2])
  for (const c of contours) {
    ctx.strokeRect(c.x, c.y, c.width, c.height)
  }
  ctx.setLineDash([])

  return canvas
}

export function createContourMask(
  width: number,
  height: number,
  contours: { x: number; y: number; width: number; height: number }[]
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = 'white'
  for (const c of contours) {
    ctx.fillRect(c.x, c.y, c.width, c.height)
  }

  return canvas
}

export function trimTransparent(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data, width, height } = imageData

  let minX = width, minY = height, maxX = 0, maxY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (minX > maxX || minY > maxY) return canvas.toDataURL('image/png')

  const trimW = maxX - minX + 1
  const trimH = maxY - minY + 1
  const trimmed = document.createElement('canvas')
  trimmed.width = trimW
  trimmed.height = trimH
  trimmed.getContext('2d')!.drawImage(
    canvas, minX, minY, trimW, trimH,
    0, 0, trimW, trimH
  )

  return trimmed.toDataURL('image/png')
}

export interface BlendOptions {
  blendMode?: import('@/types').BlendMode
  bgMean?: number
  opacity?: number
}

function boxBlurAlpha(
  imageData: ImageData,
  radius: number
): Uint8ClampedArray {
  const { data, width, height } = imageData
  const buf = new Float32Array(data.length)
  const tmp = new Float32Array(data.length)

  for (let i = 0; i < data.length; i++) buf[i] = data[i]

  for (let pass = 0; pass < 2; pass++) {
    const half = Math.max(1, Math.floor(radius / 2))
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, count = 0
        for (let dx = -half; dx <= half; dx++) {
          const nx = x + dx
          if (nx >= 0 && nx < width) {
            sum += buf[(y * width + nx) * 4 + 3]
            count++
          }
        }
        tmp[(y * width + x) * 4 + 3] = sum / count
      }
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sum = 0, count = 0
        for (let dy = -half; dy <= half; dy++) {
          const ny = y + dy
          if (ny >= 0 && ny < height) {
            sum += tmp[(ny * width + x) * 4 + 3]
            count++
          }
        }
        buf[(y * width + x) * 4 + 3] = sum / count
      }
    }
  }

  const result = new Uint8ClampedArray(data)
  for (let i = 3; i < result.length; i += 4) {
    result[i] = Math.round(buf[i])
  }
  return result
}

export function drawWithEdgeBlend(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  options: BlendOptions
) {
  ctx.save()

  const cx = x + width / 2
  const cy = y + height / 2

  ctx.translate(cx, cy)
  if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180)
  ctx.translate(-cx, -cy)

  const applyOpacity = (opacity: number) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
  }

  if (options.blendMode === 'direct') {
    applyOpacity(options.opacity ?? 1)
    ctx.drawImage(img, x, y, width, height)
    ctx.globalAlpha = 1
    ctx.restore()
    return
  }

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = width
  tempCanvas.height = height
  const tempCtx = tempCanvas.getContext('2d')!
  tempCtx.drawImage(img, 0, 0, width, height)
  const imageData = tempCtx.getImageData(0, 0, width, height)
  const data = imageData.data

  if (options.bgMean !== undefined && options.bgMean > 0) {
    let objSum = 0, objCount = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200) {
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        objSum += gray
        objCount++
      }
    }
    if (objCount > 0) {
      const objMean = objSum / objCount
      const scale = Math.max(0.3, Math.min(3.0, options.bgMean / Math.max(objMean, 1)))
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]
        if (alpha > 0) {
          const weight = Math.min(1, alpha / 200)
          const adjustedScale = 1 + (scale - 1) * weight
          data[i] = Math.min(255, Math.max(0, Math.round(data[i] * adjustedScale)))
          data[i + 1] = Math.min(255, Math.max(0, Math.round(data[i + 1] * adjustedScale)))
          data[i + 2] = Math.min(255, Math.max(0, Math.round(data[i + 2] * adjustedScale)))
        }
      }
    }
  }

  tempCtx.putImageData(imageData, 0, 0)
  applyOpacity(options.opacity ?? 1)
  ctx.drawImage(tempCanvas, x, y, width, height)
  ctx.globalAlpha = 1

  ctx.restore()
}
