import { useState, useRef, useEffect, useCallback } from 'react'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useObjectStore } from '@/stores/objectStore'
import { useDatasetStore } from '@/stores/datasetStore'
import {
  loadImage, drawWithEdgeBlend, getBagBoundary, drawYOLOBoxes,
  cropImageToRect, detectTiltedBoundary,
} from '@/utils/imageProcessing'
import { generatePlacement, randomChoice } from '@/utils/randomizer'
import type { CanvasObject, YOLOAnnotation, YOLOBoxRaw, CropRect, PolygonPoint } from '@/types'

interface BagRect { x: number; y: number; width: number; height: number }

function computeFit(
  imgW: number, imgH: number,
  canvasW: number, canvasH: number
): { drawX: number; drawY: number; drawW: number; drawH: number } {
  const scale = Math.min(canvasW / imgW, canvasH / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  const drawX = (canvasW - drawW) / 2
  const drawY = (canvasH - drawH) / 2
  return { drawX, drawY, drawW, drawH }
}

function rotatedAABB(
  x: number, y: number, w: number, h: number, rotation: number
): { cx: number; cy: number; bw: number; bh: number } {
  if (rotation === 0) {
    return { cx: x + w / 2, cy: y + h / 2, bw: w, bh: h }
  }
  const cx = x + w / 2
  const cy = y + h / 2
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = w / 2
  const hh = h / 2
  const corners = [
    { dx: -hw, dy: -hh },
    { dx: hw, dy: -hh },
    { dx: hw, dy: hh },
    { dx: -hw, dy: hh },
  ].map(({ dx, dy }) => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  }))
  const minX = Math.min(...corners.map((c) => c.x))
  const minY = Math.min(...corners.map((c) => c.y))
  const maxX = Math.max(...corners.map((c) => c.x))
  const maxY = Math.max(...corners.map((c) => c.y))
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, bw: maxX - minX, bh: maxY - minY }
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

function polygonBounds(polygon: PolygonPoint[]): BagRect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of polygon) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function getEffectiveBoundary(
  regionType: 'rect' | 'polygon' | null,
  rectBoundary: BagRect | null,
  polygonBoundary: PolygonPoint[] | null,
  bagBoundary: BagRect | null,
  imgW: number, imgH: number
): { type: 'rect' | 'polygon' | null; rect: BagRect | null; polygon: PolygonPoint[] | null } {
  if (regionType === 'polygon' && polygonBoundary) return { type: 'polygon', rect: null, polygon: polygonBoundary }
  if (regionType === 'rect' && rectBoundary) return { type: 'rect', rect: rectBoundary, polygon: null }
  if (bagBoundary) return { type: 'rect', rect: bagBoundary, polygon: null }
  return { type: 'rect', rect: { x: 0, y: 0, width: imgW, height: imgH }, polygon: null }
}

interface PreviewCanvasProps {
  currentBgId: string | null
  selectedObjectIds: string[]
  mode: 'auto' | 'manual'
}

export default function PreviewCanvas({ currentBgId, selectedObjectIds, mode }: PreviewCanvasProps) {
  const { backgrounds } = useBackgroundStore()
  const { objects, incrementUsage } = useObjectStore()
  const {
    params, currentDatasetId, addSamples, datasets, clearSamples,
    setGeneratorRegion,
  } = useDatasetStore()

  const [canvasObjects, setCanvasObjects] = useState<CanvasObject[]>([])
  const [selectedObjId, setSelectedObjId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, speed: 0 })
  const [bagBoundary, setBagBoundary] = useState<BagRect | null>(null)
  const [userBoundary, setUserBoundary] = useState<BagRect | null>(null)
  const [userPolygon, setUserPolygon] = useState<PolygonPoint[] | null>(null)
  const [yoloBoxes, setYoloBoxes] = useState<YOLOBoxRaw[]>([])
  const [cropRect, setCropRect] = useState<CropRect | null>(null)

  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [drawMode, setDrawMode] = useState<'rect' | 'polygon' | null>(null)
  const [rectDrawing, setRectDrawing] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null)
  const [polygonPoints, setPolygonPoints] = useState<PolygonPoint[]>([])
  const [polygonPreview, setPolygonPreview] = useState<PolygonPoint | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasSizeRef = useRef({ width: 800, height: 600 })
  const containerRef = useRef<HTMLDivElement>(null)
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const fitRectRef = useRef<{ drawX: number; drawY: number; drawW: number; drawH: number } | null>(null)
  const canvasScaleRef = useRef(1)
  const cropRectRef = useRef<CropRect | null>(null)
  const previewZoomRef = useRef(previewZoom)
  const previewPanRef = useRef(previewPan)
  previewZoomRef.current = previewZoom
  previewPanRef.current = previewPan

  const currentDataset = datasets.find((d) => d.id === currentDatasetId)
  const bg = backgrounds.find((b) => b.id === currentBgId)

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth
        const h = containerRef.current.clientHeight
        canvasSizeRef.current = { width: Math.max(400, w - 32), height: Math.max(300, h - 32) }
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  useEffect(() => {
    if (bg) {
      loadImage(bg.dataUrl).then((img) => {
        const detected = getBagBoundary(img, 128)
        let crop: CropRect | null = null
        let croppedImg = img

        if (detected) {
          crop = { x: detected.x, y: detected.y, width: detected.width, height: detected.height }
          setCropRect(crop)
          cropRectRef.current = crop
          setBagBoundary({ x: 0, y: 0, width: crop.width, height: crop.height })
          croppedImg = cropImageToRect(img, crop).croppedImg as unknown as HTMLImageElement
        } else {
          setCropRect(null)
          cropRectRef.current = null
          setBagBoundary({ x: 0, y: 0, width: img.width, height: img.height })
        }

        bgImgRef.current = croppedImg
        const canvasW = canvasSizeRef.current.width
        const canvasH = canvasSizeRef.current.height
        const fit = computeFit(croppedImg.width, croppedImg.height, canvasW, canvasH)
        fitRectRef.current = fit
        canvasScaleRef.current = croppedImg.width / fit.drawW

        const yoloRaw = bg.yoloBoxes || []
        const adjustedYolo: YOLOBoxRaw[] = []
        if (crop && yoloRaw.length > 0) {
          const cw = crop.width, ch = crop.height
          const fullW = img.width, fullH = img.height
          for (const box of yoloRaw) {
            const absX = box.centerX * fullW
            const absY = box.centerY * fullH
            const absW = box.width * fullW
            const absH = box.height * fullH
            const newX = absX - crop.x
            const newY = absY - crop.y
            if (newX + absW / 2 > 0 && newX - absW / 2 < cw && newY + absH / 2 > 0 && newY - absH / 2 < ch) {
              adjustedYolo.push({
                classId: box.classId,
                centerX: newX / cw,
                centerY: newY / ch,
                width: absW / cw,
                height: absH / ch,
              })
            }
          }
        }
        setYoloBoxes(crop ? adjustedYolo : yoloRaw)
        setPreviewZoom(1)
        setPreviewPan({ x: 0, y: 0 })

        const region = useDatasetStore.getState().generatorRegions[bg.id]
        if (region?.type === 'polygon' && region.polygon) {
          setUserPolygon(region.polygon)
          setUserBoundary(null)
        } else if (region?.type === 'rect' && region.rect) {
          setUserBoundary(region.rect)
          setUserPolygon(null)
        } else {
          autoDetectAndSet(croppedImg, bg.id)
        }

        renderCanvas()
      })
    } else {
      bgImgRef.current = null
      fitRectRef.current = null
      setBagBoundary(null)
      setUserBoundary(null)
      setUserPolygon(null)
      setYoloBoxes([])
      setCropRect(null)
      setPreviewZoom(1)
      setPreviewPan({ x: 0, y: 0 })
      renderCanvas()
    }
  }, [bg])

  const activeRegionType = userPolygon ? 'polygon' : userBoundary ? 'rect' : null
  const activeRect = userBoundary || bagBoundary || null
  const activePolygon = userPolygon || null

  const renderCanvas = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cw = canvasSizeRef.current.width
    const ch = canvasSizeRef.current.height
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, cw, ch)

    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, cw, ch)

    if (bgImgRef.current && fitRectRef.current) {
      const { drawX, drawY, drawW, drawH } = fitRectRef.current
      ctx.drawImage(bgImgRef.current, drawX, drawY, drawW, drawH)

      const scale = drawW / bgImgRef.current.width

      if (yoloBoxes.length > 0) {
        drawYOLOBoxes(ctx, yoloBoxes, drawX, drawY, drawW, drawH)
      }

      if (activePolygon && activePolygon.length >= 3) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)'
        ctx.lineWidth = 3
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(drawX + activePolygon[0].x * scale, drawY + activePolygon[0].y * scale)
        for (let i = 1; i < activePolygon.length; i++) {
          ctx.lineTo(drawX + activePolygon[i].x * scale, drawY + activePolygon[i].y * scale)
        }
        ctx.closePath()
        ctx.stroke()
      } else if (activeRect && !cropRect) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 3])
        const bx = drawX + activeRect.x * scale
        const by = drawY + activeRect.y * scale
        const bw = activeRect.width * scale
        const bh = activeRect.height * scale
        ctx.strokeRect(bx, by, bw, bh)
        ctx.setLineDash([])

        const margin = params.edgeMargin || 20
        const marginScaled = margin * scale
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)'
        ctx.lineWidth = 1
        ctx.setLineDash([2, 4])
        ctx.strokeRect(
          bx + marginScaled, by + marginScaled,
          bw - marginScaled * 2, bh - marginScaled * 2
        )
        ctx.setLineDash([])
      }

      for (const co of canvasObjects) {
        const foreignObj = objects.find((o) => o.id === co.foreignObjectId)
        if (!foreignObj?.cutoutImage) continue
        try {
          const img = await loadImage(co.imageData || foreignObj.cutoutImage)
          const cx = drawX + co.x * scale
          const cy = drawY + co.y * scale
          const cw2 = co.width * scale
          const ch2 = co.height * scale

          let bgMean: number | undefined
          try {
            const sx = Math.max(0, Math.floor(cx))
            const sy = Math.max(0, Math.floor(cy))
            const sw = Math.min(Math.ceil(cw2), cw - sx)
            const sh = Math.min(Math.ceil(ch2), ch - sy)
            if (sw > 1 && sh > 1) {
              const bgSample = ctx.getImageData(sx, sy, sw, sh)
              let sum = 0, count = 0
              for (let pi = 0; pi < bgSample.data.length; pi += 4) {
                sum += bgSample.data[pi] * 0.299 + bgSample.data[pi + 1] * 0.587 + bgSample.data[pi + 2] * 0.114
                count++
              }
              if (count > 0) bgMean = sum / count
            }
          } catch { /* ignore */ }

          drawWithEdgeBlend(ctx, img, cx, cy, cw2, ch2, co.rotation, {
            strength: params.edgeBlendStrength,
            blendMode: params.blendMode,
            bgMean,
            opacity: co.opacity,
          })

          if (co.rotation !== 0) {
            const rcx = cx + cw2 / 2
            const rcy = cy + ch2 / 2
            ctx.save()
            ctx.translate(rcx, rcy)
            ctx.rotate((co.rotation * Math.PI) / 180)
            ctx.translate(-rcx, -rcy)
            ctx.strokeStyle = selectedObjId === co.id ? '#ef4444' : '#3b82f6'
            ctx.lineWidth = selectedObjId === co.id ? 3 : 2
            if (selectedObjId === co.id) ctx.setLineDash([6, 3])
            ctx.strokeRect(cx, cy, cw2, ch2)
            ctx.setLineDash([])
            ctx.restore()
          } else {
            ctx.strokeStyle = selectedObjId === co.id ? '#ef4444' : '#3b82f6'
            ctx.lineWidth = selectedObjId === co.id ? 3 : 2
            if (selectedObjId === co.id) ctx.setLineDash([6, 3])
            ctx.strokeRect(cx, cy, cw2, ch2)
            ctx.setLineDash([])
          }

          const label = foreignObj.category || foreignObj.name
          const textWidth = ctx.measureText(label).width
          ctx.fillStyle = '#3b82f6'
          ctx.fillRect(cx, cy - 18, textWidth + 8, 18)
          ctx.fillStyle = '#fff'
          ctx.font = '11px sans-serif'
          ctx.fillText(label, cx + 4, cy - 5)
        } catch { /* ignore */ }
      }

      if (drawMode === 'polygon' && polygonPoints.length > 0) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 3])
        ctx.beginPath()
        ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y)
        for (let i = 1; i < polygonPoints.length; i++) {
          ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y)
        }
        if (polygonPreview) {
          ctx.lineTo(polygonPreview.x, polygonPreview.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        for (const pt of polygonPoints) {
          ctx.fillStyle = '#22c55e'
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      if (drawMode === 'rect' && rectDrawing) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 3])
        const rx = Math.min(rectDrawing.sx, rectDrawing.cx)
        const ry = Math.min(rectDrawing.sy, rectDrawing.cy)
        const rw = Math.abs(rectDrawing.cx - rectDrawing.sx)
        const rh = Math.abs(rectDrawing.cy - rectDrawing.sy)
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.setLineDash([])
      }
    }
  }, [canvasObjects, bgImgRef, selectedObjId, params, objects, bagBoundary, userBoundary, userPolygon, drawMode, rectDrawing, polygonPoints, polygonPreview, yoloBoxes, cropRect])
  const renderCanvasRef = useRef(renderCanvas)
  renderCanvasRef.current = renderCanvas

  const autoDetectAndSet = useCallback((img: HTMLImageElement, bgId: string) => {
    const corners = detectTiltedBoundary(img)
    if (corners && corners.length >= 3) {
      setUserPolygon(corners)
      setUserBoundary(null)
      useDatasetStore.getState().setGeneratorRegion(bgId, {
        type: 'polygon', rect: null, polygon: null, autoPolygon: corners,
      })
    } else {
      setUserBoundary(null)
      setUserPolygon(null)
    }
  }, [])

  useEffect(() => { renderCanvas() }, [renderCanvas])

  const canvasToImageCoords = useCallback((fx: number, fy: number): { x: number; y: number } | null => {
    if (!fitRectRef.current || !bgImgRef.current) return null
    const { drawX, drawY, drawW, drawH } = fitRectRef.current
    if (fx < drawX || fx > drawX + drawW || fy < drawY || fy > drawY + drawH) return null
    const scale = bgImgRef.current.width / drawW
    return { x: (fx - drawX) * scale, y: (fy - drawY) * scale }
  }, [])

  const fitToImageCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas || !fitRectRef.current || !bgImgRef.current) return null
    const rect = canvas.getBoundingClientRect()
    const fx = (clientX - rect.left) / previewZoom
    const fy = (clientY - rect.top) / previewZoom
    return canvasToImageCoords(fx, fy)
  }, [previewZoom, canvasToImageCoords])

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === 'polygon') {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / previewZoom
      const fy = (e.clientY - rect.top) / previewZoom
      if (fitRectRef.current) {
        const { drawX, drawY, drawW, drawH } = fitRectRef.current
        if (fx < drawX || fx > drawX + drawW || fy < drawY || fy > drawY + drawH) return
      }
      setPolygonPoints((prev) => [...prev, { x: fx, y: fy }])
      return
    }

    if (drawMode === 'rect') {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / previewZoom
      const fy = (e.clientY - rect.top) / previewZoom
      setRectDrawing({ sx: fx, sy: fy, cx: fx, cy: fy })
      return
    }

    setIsPanning(true)
    setPanStart({ x: e.clientX - previewPan.x, y: e.clientY - previewPan.y })
  }, [drawMode, previewPan, previewZoom])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === 'polygon') {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / previewZoom
      const fy = (e.clientY - rect.top) / previewZoom
      setPolygonPreview({ x: fx, y: fy })
      return
    }

    if (drawMode === 'rect' && rectDrawing) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / previewZoom
      const fy = (e.clientY - rect.top) / previewZoom
      setRectDrawing((prev) => prev ? { ...prev, cx: fx, cy: fy } : null)
      return
    }

    if (isPanning) {
      setPreviewPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }, [drawMode, rectDrawing, isPanning, panStart, previewZoom])

  const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === 'rect' && rectDrawing) {
      const canvas = canvasRef.current
      if (canvas && fitRectRef.current && bgImgRef.current) {
        const rect = canvas.getBoundingClientRect()
        const fx = (e.clientX - rect.left) / previewZoom
        const fy = (e.clientY - rect.top) / previewZoom
        const minX = Math.min(rectDrawing.sx, fx)
        const minY = Math.min(rectDrawing.sy, fy)
        const maxX = Math.max(rectDrawing.sx, fx)
        const maxY = Math.max(rectDrawing.sy, fy)
        if (Math.abs(maxX - minX) > 5 && Math.abs(maxY - minY) > 5) {
          const imgCoords1 = canvasToImageCoords(minX, minY)
          const imgCoords2 = canvasToImageCoords(maxX, maxY)
          if (imgCoords1 && imgCoords2) {
            const ub: BagRect = {
              x: Math.round(imgCoords1.x),
              y: Math.round(imgCoords1.y),
              width: Math.round(imgCoords2.x - imgCoords1.x),
              height: Math.round(imgCoords2.y - imgCoords1.y),
            }
            setUserBoundary(ub)
            setUserPolygon(null)
            if (bg) setGeneratorRegion(bg.id, { type: 'rect', rect: ub, polygon: null, autoPolygon: null })
          }
        }
      }
      setRectDrawing(null)
      setDrawMode(null)
      return
    }

    if (drawMode === 'polygon') return
    setIsPanning(false)
  }, [drawMode, rectDrawing, canvasToImageCoords, previewZoom, setGeneratorRegion])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === 'rect' || drawMode === 'polygon') return
    if (mode !== 'manual') return
    const coords = fitToImageCoords(e.clientX, e.clientY)
    if (!coords) { setSelectedObjId(null); return }
    let clickedId: string | null = null
    for (const co of [...canvasObjects].reverse()) {
      if (coords.x >= co.x && coords.x <= co.x + co.width &&
          coords.y >= co.y && coords.y <= co.y + co.height) {
        clickedId = co.id
        break
      }
    }
    setSelectedObjId(clickedId)
  }, [drawMode, mode, canvasObjects, fitToImageCoords])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const objectId = e.dataTransfer.getData('objectId')
    if (!objectId) return
    const foreignObj = objects.find((o) => o.id === objectId)
    if (!foreignObj || !bgImgRef.current) return

    const coords = fitToImageCoords(e.clientX, e.clientY)
    if (!coords) return

    const img = new Image()
    img.onload = () => {
      const imgScale = Math.min(1, (bgImgRef.current!.width * 0.25) / img.width)
      const w = img.width * imgScale
      const h = img.height * imgScale

      let nx = Math.max(0, coords.x - w / 2)
      let ny = Math.max(0, coords.y - h / 2)

      if (activePolygon && activePolygon.length >= 3) {
        const cenX = coords.x, cenY = coords.y
        if (!pointInPolygon(cenX, cenY, activePolygon)) {
          const pb = polygonBounds(activePolygon)
          nx = pb.x + pb.width / 2 - w / 2
          ny = pb.y + pb.height / 2 - h / 2
        }
        const margin = params.edgeMargin || 20
        const corners = [{ x: nx, y: ny }, { x: nx + w, y: ny }, { x: nx, y: ny + h }, { x: nx + w, y: ny + h }]
        if (!corners.every((c) => pointInPolygon(c.x, c.y, activePolygon))) {
          const pb = polygonBounds(activePolygon)
          nx = pb.x + pb.width / 2 - w / 2
          ny = pb.y + pb.height / 2 - h / 2
        }
      } else {
        const boundary = userBoundary || bagBoundary
        if (boundary) {
          const margin = params.edgeMargin || 20
          nx = Math.max(boundary.x + margin, Math.min(nx, boundary.x + boundary.width - w - margin))
          ny = Math.max(boundary.y + margin, Math.min(ny, boundary.y + boundary.height - h - margin))
        }
      }

      const newObj: CanvasObject = {
        id: crypto.randomUUID(), foreignObjectId: objectId,
        x: nx, y: ny, width: w, height: h,
        rotation: 0, scaleX: 1, scaleY: 1,
        opacity: 1, imageData: foreignObj.cutoutImage || foreignObj.thumbnail,
      }
      setCanvasObjects((prev) => [...prev, newObj])
      incrementUsage(objectId)
    }
    img.src = foreignObj.cutoutImage || foreignObj.thumbnail
  }, [objects, params, bagBoundary, userBoundary, fitToImageCoords, incrementUsage])

  const handleDelete = useCallback(() => {
    if (selectedObjId) {
      setCanvasObjects((prev) => prev.filter((co) => co.id !== selectedObjId))
      setSelectedObjId(null)
    }
  }, [selectedObjId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace' || (e.ctrlKey && e.key === 'z')) {
        if (drawMode === 'polygon' && polygonPoints.length > 0) {
          setPolygonPoints((prev) => prev.slice(0, -1))
          e.preventDefault()
          return
        }
        handleDelete()
      }
      if (e.key === 'Enter' && drawMode === 'polygon' && polygonPoints.length >= 3) {
        const imgPoints = polygonPoints
          .map((pt) => canvasToImageCoords(pt.x, pt.y))
          .filter(Boolean) as PolygonPoint[]
        if (imgPoints.length >= 3) {
          setUserPolygon(imgPoints)
          setUserBoundary(null)
          setDrawMode(null)
          setPolygonPoints([])
          setPolygonPreview(null)
          if (bg) setGeneratorRegion(bg.id, { type: 'polygon', rect: null, polygon: imgPoints, autoPolygon: null })
        }
      }
      if (e.key === 'Escape' && drawMode) {
        setDrawMode(null)
        setRectDrawing(null)
        setPolygonPoints([])
        setPolygonPreview(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDelete, drawMode, polygonPoints, canvasToImageCoords, setGeneratorRegion])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const z = previewZoomRef.current
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const newZ = Math.max(0.5, Math.min(10, z + delta))
      if (newZ === z) return
      setPreviewZoom(newZ)
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  const processedObjects = objects.filter((o) => o.maskData && o.cutoutImage)

  const getActiveObjects = useCallback(() => {
    if (selectedObjectIds.length > 0) return processedObjects.filter((o) => selectedObjectIds.includes(o.id))
    return processedObjects
  }, [processedObjects, selectedObjectIds])

  const getBoundary = useCallback((): BagRect | undefined => {
    if (activePolygon) return polygonBounds(activePolygon)
    if (userBoundary) return userBoundary
    if (bagBoundary) return bagBoundary
    if (bgImgRef.current) return { x: 0, y: 0, width: bgImgRef.current.width, height: bgImgRef.current.height }
    return undefined
  }, [bagBoundary, userBoundary, activePolygon])

  const generateAutoPreview = useCallback(() => {
    if (!bg || processedObjects.length === 0) return
    const activeObjects = getActiveObjects()
    if (activeObjects.length === 0) return
    setCanvasObjects([])

    const numObjects = Math.floor(Math.random() * (params.objectCountMax - params.objectCountMin + 1) + params.objectCountMin)
    const selectedObjects = Array.from({ length: numObjects }, () => randomChoice(activeObjects))

    const imgW = bgImgRef.current!.width
    const imgH = bgImgRef.current!.height
    const boundary = getBoundary()

    const loadAndPlace = selectedObjects.map(async (foreignObj) => {
      if (!foreignObj.cutoutImage) return null
      try {
        const img = await loadImage(foreignObj.cutoutImage)
        const placement = generatePlacement(imgW, imgH, img.width, img.height, params, boundary, activePolygon)
        return {
          id: crypto.randomUUID(), foreignObjectId: foreignObj.id,
          x: placement.x, y: placement.y,
          width: placement.width, height: placement.height,
          rotation: placement.rotation, scaleX: 1, scaleY: 1,
          opacity: placement.opacity, imageData: foreignObj.cutoutImage,
        } as CanvasObject
      } catch { return null }
    })

    Promise.all(loadAndPlace).then((results) => {
      setCanvasObjects(results.filter(Boolean) as CanvasObject[])
    })
  }, [bg, objects, params, getActiveObjects, getBoundary])

  const handleGenerate = useCallback(async () => {
    if (!bg || !currentDatasetId) return
    const activeObjects = getActiveObjects()
    if (activeObjects.length === 0) return
    setIsGenerating(true)
    setProgress({ current: 0, total: params.totalCount, speed: 0 })

    const startTime = Date.now()
    const samples: Array<{ imageData: string; annotations: YOLOAnnotation[]; datasetId: string; generatedAt: number }> = []
    const imgW = bgImgRef.current!.width
    const imgH = bgImgRef.current!.height
    const boundary = getBoundary()

    const existingAnnotations: YOLOAnnotation[] = (bg.yoloBoxes || []).map((box) => ({
      classId: 0,
      centerX: box.centerX,
      centerY: box.centerY,
      width: box.width,
      height: box.height,
    }))

    for (let i = 0; i < params.totalCount; i++) {
      const numObjects = Math.floor(Math.random() * (params.objectCountMax - params.objectCountMin + 1) + params.objectCountMin)
      const selectedObjects = Array.from({ length: numObjects }, () => randomChoice(activeObjects))
      const annotations: YOLOAnnotation[] = [...existingAnnotations]
      const placementResults: { obj: typeof objects[0]; placement: ReturnType<typeof generatePlacement>; img: HTMLImageElement }[] = []

      for (const foreignObj of selectedObjects) {
        if (!foreignObj.cutoutImage) continue
        try {
          const img = await loadImage(foreignObj.cutoutImage)
          const placement = generatePlacement(imgW, imgH, img.width, img.height, params, boundary, activePolygon)
          placementResults.push({ obj: foreignObj, placement, img })

          const aabb = rotatedAABB(placement.x, placement.y, placement.width, placement.height, placement.rotation)
          const expandRatio = params.bboxStrategy === 'expand' ? 1 + params.bboxExpandRatio / 100 : 1
          annotations.push({
            classId: 0,
            centerX: aabb.cx,
            centerY: aabb.cy,
            width: aabb.bw * expandRatio,
            height: aabb.bh * expandRatio,
          })
        } catch { /* ignore */ }
      }

      const genCanvas = document.createElement('canvas')
      genCanvas.width = imgW
      genCanvas.height = imgH
      const genCtx = genCanvas.getContext('2d')!
      genCtx.fillStyle = '#ffffff'
      genCtx.fillRect(0, 0, imgW, imgH)
      if (bgImgRef.current) genCtx.drawImage(bgImgRef.current, 0, 0)

      for (const { img, placement } of placementResults) {
        let bgMean: number | undefined
        try {
          const sx = Math.max(0, Math.floor(placement.x))
          const sy = Math.max(0, Math.floor(placement.y))
          const sw = Math.min(Math.ceil(placement.width), imgW - sx)
          const sh = Math.min(Math.ceil(placement.height), imgH - sy)
          if (sw > 1 && sh > 1) {
            const bgSample = genCtx.getImageData(sx, sy, sw, sh)
            let sum = 0, count = 0
            for (let pi = 0; pi < bgSample.data.length; pi += 4) {
              sum += bgSample.data[pi] * 0.299 + bgSample.data[pi + 1] * 0.587 + bgSample.data[pi + 2] * 0.114
              count++
            }
            if (count > 0) bgMean = sum / count
          }
        } catch { /* ignore */ }
        drawWithEdgeBlend(genCtx, img, placement.x, placement.y, placement.width, placement.height, placement.rotation, {
          strength: params.edgeBlendStrength,
          blendMode: params.blendMode,
          bgMean,
          opacity: placement.opacity,
        })
      }

      if (params.blurVariance || params.brightnessVariance || params.contrastVariance) {
        const filters: string[] = []
        if (params.blurVariance) filters.push(`blur(${Math.random() * 2}px)`)
        if (params.brightnessVariance) filters.push(`brightness(${0.85 + Math.random() * 0.3})`)
        if (params.contrastVariance) filters.push(`contrast(${0.85 + Math.random() * 0.3})`)
        genCtx.filter = filters.join(' ')
        genCtx.drawImage(genCanvas, 0, 0)
        genCtx.filter = 'none'
      }

      const imageData = genCanvas.toDataURL('image/jpeg', 0.95)
      samples.push({ imageData, annotations, datasetId: currentDatasetId, generatedAt: Date.now() })
      for (const { obj } of placementResults) incrementUsage(obj.id)

      const elapsed = (Date.now() - startTime) / 1000
      setProgress({ current: i + 1, total: params.totalCount, speed: elapsed > 0 ? (i + 1) / elapsed : 0 })
    }

    await addSamples(samples)
    setIsGenerating(false)
  }, [bg, objects, selectedObjectIds, currentDatasetId, params, addSamples, incrementUsage, getActiveObjects, getBoundary])

  const handleManualGenerate = useCallback(async () => {
    if (!bg || !currentDatasetId || canvasObjects.length === 0 || !bgImgRef.current) return
    const imgW = bgImgRef.current.width
    const imgH = bgImgRef.current.height
    const genCanvas = document.createElement('canvas')
    genCanvas.width = imgW
    genCanvas.height = imgH
    const genCtx = genCanvas.getContext('2d')!
    genCtx.fillStyle = '#ffffff'
    genCtx.fillRect(0, 0, imgW, imgH)
    genCtx.drawImage(bgImgRef.current, 0, 0)

    const existingAnnotations: YOLOAnnotation[] = (bg.yoloBoxes || []).map((box) => ({
      classId: 0, centerX: box.centerX, centerY: box.centerY, width: box.width, height: box.height,
    }))
    const annotations: YOLOAnnotation[] = [...existingAnnotations]

    for (const co of canvasObjects) {
      const foreignObj = objects.find((o) => o.id === co.foreignObjectId)
      if (!foreignObj?.cutoutImage) continue
      try {
        const img = await loadImage(co.imageData || foreignObj.cutoutImage)
        let bgMean: number | undefined
        try {
          const sx = Math.max(0, Math.floor(co.x)), sy = Math.max(0, Math.floor(co.y))
          const sw = Math.min(Math.ceil(co.width), imgW - sx), sh = Math.min(Math.ceil(co.height), imgH - sy)
          if (sw > 1 && sh > 1) {
            const bgSample = genCtx.getImageData(sx, sy, sw, sh)
            let sum = 0, count = 0
            for (let pi = 0; pi < bgSample.data.length; pi += 4) {
              sum += bgSample.data[pi] * 0.299 + bgSample.data[pi + 1] * 0.587 + bgSample.data[pi + 2] * 0.114
              count++
            }
            if (count > 0) bgMean = sum / count
          }
        } catch { /* ignore */ }
        drawWithEdgeBlend(genCtx, img, co.x, co.y, co.width, co.height, co.rotation, {
          strength: params.edgeBlendStrength, blendMode: params.blendMode, bgMean, opacity: co.opacity,
        })
        const expandRatio = params.bboxStrategy === 'expand' ? 1 + params.bboxExpandRatio / 100 : 1
        const aabb = rotatedAABB(co.x, co.y, co.width, co.height, co.rotation)
        annotations.push({ classId: 0, centerX: aabb.cx, centerY: aabb.cy, width: aabb.bw * expandRatio, height: aabb.bh * expandRatio })
        incrementUsage(co.foreignObjectId)
      } catch { /* ignore */ }
    }

    if (params.blurVariance || params.brightnessVariance || params.contrastVariance) {
      const filters: string[] = []
      if (params.blurVariance) filters.push(`blur(${Math.random() * 2}px)`)
      if (params.brightnessVariance) filters.push(`brightness(${0.85 + Math.random() * 0.3})`)
      if (params.contrastVariance) filters.push(`contrast(${0.85 + Math.random() * 0.3})`)
      genCtx.filter = filters.join(' ')
      genCtx.drawImage(genCanvas, 0, 0)
      genCtx.filter = 'none'
    }

    const imageData = genCanvas.toDataURL('image/jpeg', 0.95)
    await addSamples([{ imageData, annotations, datasetId: currentDatasetId, generatedAt: Date.now() }])
    setCanvasObjects([])
  }, [bg, currentDatasetId, canvasObjects, params, objects, addSamples, incrementUsage])

  const handleOverwriteGenerate = useCallback(async () => {
    if (!bg || !currentDatasetId) return
    await clearSamples()
    await handleGenerate()
  }, [bg, currentDatasetId, clearSamples, handleGenerate])

  const handleAutoDetectRegion = useCallback(async () => {
    if (!bg || !bgImgRef.current) return
    autoDetectAndSet(bgImgRef.current, bg.id)
    renderCanvasRef.current()
  }, [bg, autoDetectAndSet])

  const canGenerate = !!bg && processedObjects.length > 0
  const selectedInfo = selectedObjectIds.length > 0 ? `已选 ${selectedObjectIds.length} 个异物` : null

  const cursorStyle = drawMode === 'polygon' ? 'crosshair' : drawMode === 'rect' ? 'crosshair' : 'default'

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="panel-title !mb-0">实时预览画布</h2>
        </div>
        <div className="flex items-center gap-2">
          {currentDataset && (
            <span className="text-xs text-gray-400">
              {currentDataset.name} | {currentDataset.generatedImages} 张
            </span>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden p-4"
      >
        <div
          style={{
            transform: `scale(${previewZoom}) translate(${previewPan.x / previewZoom}px, ${previewPan.y / previewZoom}px)`,
            transformOrigin: 'center',
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasSizeRef.current.width}
            height={canvasSizeRef.current.height}
            className="rounded-lg"
            onClick={handleCanvasClick}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            style={{ cursor: cursorStyle }}
          />
        </div>
      </div>

      {isGenerating && (
        <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div className="bg-primary-500 h-full rounded-full transition-all duration-200"
                style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
            <span className="text-xs text-gray-500 tabular-nums">{progress.current}/{progress.total}</span>
          </div>
          <div className="text-xs text-gray-400 flex gap-4">
            <span>速度: {progress.speed.toFixed(1)} 张/秒</span>
            <span>预计剩余: {progress.speed > 0 ? Math.ceil((progress.total - progress.current) / progress.speed) : '--'}s</span>
          </div>
        </div>
      )}

      <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 flex-wrap">
        <button onClick={() => setPreviewZoom((z) => Math.min(z + 0.25, 10))} className="btn-secondary text-xs px-2 py-1">🔍+</button>
        <button onClick={() => setPreviewZoom((z) => Math.max(z - 0.25, 0.5))} className="btn-secondary text-xs px-2 py-1">🔍-</button>
        <span className="text-xs text-gray-400">{Math.round(previewZoom * 100)}%</span>
        <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <button
          onClick={() => { setDrawMode('rect'); setPolygonPoints([]); setPolygonPreview(null) }}
          className={`px-2.5 py-1 rounded text-xs transition-all ${drawMode === 'rect' ? 'bg-green-500 text-white' : 'btn-secondary'}`}
        >
          📐 {drawMode === 'rect' ? '绘制中...' : '矩形区域'}
        </button>
        <button
          onClick={() => { setDrawMode('polygon'); setRectDrawing(null) }}
          className={`px-2.5 py-1 rounded text-xs transition-all ${drawMode === 'polygon' ? 'bg-green-500 text-white' : 'btn-secondary'}`}
        >
          🔷 {drawMode === 'polygon' ? `多边形 (${polygonPoints.length}点)` : '多边形区域'}
        </button>
        {drawMode === 'polygon' && polygonPoints.length >= 3 && (
          <span className="text-xs text-green-500">按 Enter 完成绘制</span>
        )}
        {drawMode === 'polygon' && polygonPoints.length > 0 && (
          <span className="text-xs text-gray-400">Ctrl+Z 撤销一点</span>
        )}
        <button onClick={handleAutoDetectRegion} disabled={!bg} className="btn-secondary text-xs px-2 py-1">
          🤖 自动检测区域
        </button>
        {(userBoundary || activePolygon) && (
          <button onClick={() => {
            setUserBoundary(null); setUserPolygon(null)
            if (bg) setGeneratorRegion(bg.id, null)
            renderCanvasRef.current()
          }} className="btn-secondary text-xs px-2 py-1">
            ✕ 清除区域
          </button>
        )}
        {drawMode && (
          <button onClick={() => { setDrawMode(null); setRectDrawing(null); setPolygonPoints([]); setPolygonPreview(null) }}
            className="btn-secondary text-xs px-2 py-1">
            ✕ 取消绘制
          </button>
        )}
        {yoloBoxes.length > 0 && (
          <span className="text-xs text-red-400">📦 {yoloBoxes.length} 个已有标注</span>
        )}
        <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
        {mode === 'auto' ? (
          <>
            <button onClick={generateAutoPreview} disabled={!canGenerate} className="btn-secondary text-xs">🎲 随机预览</button>
            <button onClick={handleGenerate} disabled={!canGenerate || isGenerating} className="btn-primary text-xs">
              ⚡ 追加生成 ({params.totalCount} 张)
            </button>
            <button onClick={handleOverwriteGenerate} disabled={!canGenerate || isGenerating} className="btn-danger text-xs">
              🔄 覆盖生成 ({params.totalCount} 张)
            </button>
            {selectedInfo && <span className="text-xs text-primary-500 ml-2">{selectedInfo}</span>}
          </>
        ) : (
          <>
            <button onClick={handleDelete} disabled={!selectedObjId} className="btn-danger text-xs">🗑 删除异物</button>
            <button onClick={() => setCanvasObjects([])} className="btn-secondary text-xs">清空画布</button>
            <button onClick={handleManualGenerate} disabled={!canGenerate || canvasObjects.length === 0}
              className="btn-primary text-xs">📸 生成当前画布</button>
            <span className="text-xs text-gray-400">拖拽异物到画布上</span>
          </>
        )}
      </div>
    </div>
  )
}
