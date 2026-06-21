import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useObjectStore } from '@/stores/objectStore'
import {
  loadImage, applyMask, trimTransparent, detectContoursByThreshold,
  parseYOLOTxt, adjustYOLOBoxesForCrop, drawYOLOBoxes, cropImageToRect,
} from '@/utils/imageProcessing'
import type { YOLOBoxRaw } from '@/types'

interface ObjectEditorProps {
  editingId: string | null
  onNew: () => void
  uploadTrigger: number
  folderTrigger: number
  onImagesUploaded: (images: UploadedImage[]) => void
  onImageProcessed: (dataUrl: string) => void
}

type Tool = 'brush' | 'eraser' | 'polygon'

interface HistoryEntry {
  maskDataUrl: string
}

export interface UploadedImage {
  dataUrl: string
  name: string
  yoloBoxes?: YOLOBoxRaw[]
}

export default function ObjectEditor({ editingId, onNew, uploadTrigger, folderTrigger, onImagesUploaded, onImageProcessed }: ObjectEditorProps) {
  const PRESET_CATEGORIES = ['点状', '条状', '片状', '块状', '其他']
  const { objects, addObject, updateObject, removeObjects } = useObjectStore()

  const [tool, setTool] = useState<Tool>('brush')
  const [brushSize, setBrushSize] = useState(5)
  const [zoom, setZoom] = useState(1)
  const [newName, setNewName] = useState('')
  const [maskCat, setMaskCat] = useState('点状')
  const [showCustomCat, setShowCustomCat] = useState(false)
  const [pendingLoadVer, setPendingLoadVer] = useState(0)
  const [customCatInput, setCustomCatInput] = useState('')
  const [localCustomCategories, setLocalCustomCategories] = useState<string[]>([])
  const [originalSrc, setOriginalSrc] = useState<string | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [yoloBoxes, setYoloBoxes] = useState<YOLOBoxRaw[]>([])
  const [polygonPoints, setPolygonPoints] = useState<{ x: number; y: number }[]>([])
  const [polygonPreview, setPolygonPreview] = useState<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const isNewMode = editingId === null
  const editObj = editingId ? objects.find((o) => o.id === editingId) : null
  const storeCustomCategories = useMemo(() => {
    const cats = new Set(objects.map((o) => o.category).filter(Boolean))
    PRESET_CATEGORIES.forEach((c) => cats.delete(c))
    return Array.from(cats)
  }, [objects])
  const customCategories = useMemo(() => {
    return [...new Set([...storeCustomCategories, ...localCustomCategories])]
  }, [storeCustomCategories, localCustomCategories])
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null!)
  const folderInputRef = useRef<HTMLInputElement>(null!)
  const zoomRef = useRef(zoom)
  const panRef = useRef(panOffset)
  const imgSizeRef = useRef(imgSize)
  const yoloBoxesRef = useRef(yoloBoxes)
  const rawUploadedUrlRef = useRef('')
  const editObjRef = useRef(editObj)
  const pendingLoadRef = useRef<{ finalSrc: string; finalW: number; finalH: number; finalBoxes: YOLOBoxRaw[]; dataUrl: string; baseName: string } | null>(null)
  editObjRef.current = editObj
  zoomRef.current = zoom
  panRef.current = panOffset
  imgSizeRef.current = imgSize

  useEffect(() => {
    if (folderInputRef.current) {
      ;(folderInputRef.current as any).webkitdirectory = true
    }
  })

  useEffect(() => {
    if (uploadTrigger > 0) {
      fileInputRef.current?.click()
    }
  }, [uploadTrigger])

  useEffect(() => {
    if (folderTrigger > 0) {
      folderInputRef.current?.click()
    }
  }, [folderTrigger])

  useEffect(() => {
    yoloBoxesRef.current = yoloBoxes
  }, [yoloBoxes])

  useEffect(() => {
    if (editingId && editObj) {
      setNewName(editObj.name)
      setMaskCat(editObj.category || '点状')
      setShowCustomCat(false)
      setCustomCatInput('')
      setPreviewSrc(editObj.cutoutImage || editObj.thumbnail)
      setYoloBoxes(editObj.yoloBoxes || [])
      yoloBoxesRef.current = editObj.yoloBoxes || []
      setZoom(1)
      setPanOffset({ x: 0, y: 0 })
      setHistory([])
      setHistoryIdx(-1)
      if (editObj.originalImage) {
        loadImage(editObj.originalImage).then((img) => {
          imgRef.current = img
          setImgSize({ width: img.width, height: img.height })
          imgSizeRef.current = { width: img.width, height: img.height }
          setOriginalSrc(editObj.originalImage)
          const maskCanvas = maskCanvasRef.current
          if (maskCanvas) {
            maskCanvas.width = img.width
            maskCanvas.height = img.height
            const ctx = maskCanvas.getContext('2d')!
            maskCtxRef.current = ctx
            ctx.clearRect(0, 0, img.width, img.height)
            if (editObj.maskData) {
              loadImage(editObj.maskData).then((maskImg) => {
                ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
                ctx.drawImage(maskImg, 0, 0)
                saveHistory()
                refreshDisplay()
              })
            } else {
              saveHistory()
              refreshDisplay()
            }
          }
        })
      }
    } else {
      resetEditor()
    }
  }, [editingId])

  const resetEditor = () => {
    setTool('brush')
    setBrushSize(5)
    setZoom(1)
    setNewName('')
    setMaskCat('点状')
    setShowCustomCat(false)
    setCustomCatInput('')
    setOriginalSrc(null)
    setPreviewSrc(null)
    setIsDrawing(false)
    setIsPanning(false)
    setPanOffset({ x: 0, y: 0 })
    setImgSize({ width: 0, height: 0 })
    imgSizeRef.current = { width: 0, height: 0 }
    setHistory([])
    setHistoryIdx(-1)
    setUploadedImages([])
    setYoloBoxes([])
    yoloBoxesRef.current = []
    imgRef.current = null
    maskCtxRef.current = null
    if (maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext('2d')
      ctx?.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height)
    }
    if (displayCanvasRef.current) {
      const ctx = displayCanvasRef.current.getContext('2d')
      ctx?.clearRect(0, 0, displayCanvasRef.current.width, displayCanvasRef.current.height)
    }
  }

  const refreshDisplay = useCallback(() => {
    const displayCanvas = displayCanvasRef.current
    const maskCanvas = maskCanvasRef.current
    if (!displayCanvas || !imgRef.current) return

    const iw = imgSizeRef.current.width
    const ih = imgSizeRef.current.height
    displayCanvas.width = iw
    displayCanvas.height = ih
    displayCanvas.style.width = iw + 'px'
    displayCanvas.style.height = ih + 'px'
    const dCtx = displayCanvas.getContext('2d')!
    dCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height)
    dCtx.drawImage(imgRef.current, 0, 0)

    if (maskCanvas) {
      const overlayCanvas = document.createElement('canvas')
      overlayCanvas.width = iw
      overlayCanvas.height = ih
      const oCtx = overlayCanvas.getContext('2d')!
      oCtx.drawImage(maskCanvas, 0, 0, iw, ih)
      const overlayData = oCtx.getImageData(0, 0, iw, ih)
      for (let i = 3; i < overlayData.data.length; i += 4) {
        if (overlayData.data[i] > 128) {
          overlayData.data[i - 3] = 34
          overlayData.data[i - 2] = 197
          overlayData.data[i - 1] = 94
          overlayData.data[i] = 100
        } else {
          overlayData.data[i] = 0
        }
      }
      oCtx.putImageData(overlayData, 0, 0)
      dCtx.drawImage(overlayCanvas, 0, 0)
    }

    const boxes = yoloBoxesRef.current
    const isProcessed = !!editObjRef.current?.maskData
    if (boxes.length > 0 && !isProcessed) {
      drawYOLOBoxes(dCtx, boxes, 0, 0, iw, ih)
    }
  }, [])

  const updatePreviewFromMask = useCallback(async () => {
    if (!imgRef.current || !maskCanvasRef.current) return
    try {
      const resultCanvas = applyMask(imgRef.current, maskCanvasRef.current)
      const trimmed = trimTransparent(resultCanvas)
      setPreviewSrc(trimmed)
    } catch { /* ignore */ }
  }, [])

  const saveHistory = useCallback(() => {
    if (!maskCanvasRef.current) return
    const dataUrl = maskCanvasRef.current.toDataURL('image/png')
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIdx + 1)
      newHistory.push({ maskDataUrl: dataUrl })
      if (newHistory.length > 50) newHistory.shift()
      return newHistory
    })
    setHistoryIdx((prev) => Math.min(prev + 1, 49))
  }, [historyIdx])

  useEffect(() => {
    const data = pendingLoadRef.current
    if (!data || pendingLoadVer === 0) return
    pendingLoadRef.current = null
    const { finalSrc, finalW, finalH, finalBoxes, dataUrl } = data
    loadImage(finalSrc).then((img) => {
      imgRef.current = img
      const iw = img.width
      const ih = img.height
      setImgSize({ width: iw, height: ih })
      imgSizeRef.current = { width: iw, height: ih }
      setOriginalSrc(finalSrc)
      rawUploadedUrlRef.current = dataUrl
    setYoloBoxes(finalBoxes)
    yoloBoxesRef.current = finalBoxes
      yoloBoxesRef.current = finalBoxes
      setZoom(1)
      setPanOffset({ x: 0, y: 0 })
      const maskCanvas = maskCanvasRef.current
      if (maskCanvas) {
        maskCanvas.width = finalW
        maskCanvas.height = finalH
        const ctx = maskCanvas.getContext('2d')!
        maskCtxRef.current = ctx
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      }
      refreshDisplay()
      saveHistory()
      updatePreviewFromMask()
    })
  }, [pendingLoadVer, refreshDisplay, saveHistory, updatePreviewFromMask])

  const restoreHistory = useCallback((entry: HistoryEntry | null) => {
    if (!maskCanvasRef.current) return
    if (!entry) {
      const maskCanvas = maskCanvasRef.current
      const ctx = maskCanvas.getContext('2d')!
      maskCtxRef.current = ctx
      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      refreshDisplay()
      updatePreviewFromMask()
      return
    }
    loadImage(entry.maskDataUrl).then((img) => {
      const maskCanvas = maskCanvasRef.current!
      maskCanvas.width = img.width
      maskCanvas.height = img.height
      const ctx = maskCanvas.getContext('2d')!
      maskCtxRef.current = ctx
      ctx.drawImage(img, 0, 0)
      refreshDisplay()
      updatePreviewFromMask()
    })
  }, [refreshDisplay, updatePreviewFromMask])

  const undo = useCallback(() => {
    if (historyIdx < 0) return
    if (historyIdx === 0) {
      setHistoryIdx(-1)
      restoreHistory(null)
      return
    }
    const newIdx = historyIdx - 1
    setHistoryIdx(newIdx)
    restoreHistory(history[newIdx])
  }, [historyIdx, history, restoreHistory])

  const redo = useCallback(() => {
    if (historyIdx >= history.length - 1) return
    const newIdx = historyIdx + 1
    setHistoryIdx(newIdx)
    restoreHistory(history[newIdx])
  }, [historyIdx, history, restoreHistory])

  const processImageWithCropAndYOLO = useCallback(async (
    dataUrl: string,
    fileName: string,
    yoloBoxesRaw: YOLOBoxRaw[] | undefined
  ): Promise<{ finalSrc: string; finalW: number; finalH: number; finalBoxes: YOLOBoxRaw[] }> => {
    const img = await loadImage(dataUrl)
    const result = detectContoursByThreshold(img, 128, true)

    if (result.contours.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of result.contours) {
        if (c.x < minX) minX = c.x
        if (c.y < minY) minY = c.y
        if (c.x + c.width > maxX) maxX = c.x + c.width
        if (c.y + c.height > maxY) maxY = c.y + c.height
      }
      const crop = {
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        width: Math.min(img.width - minX, maxX - minX),
        height: Math.min(img.height - minY, maxY - minY),
      }

      const { dataUrl: croppedDataUrl } = cropImageToRect(img, crop)

      let adjustedBoxes: YOLOBoxRaw[] = []
      if (yoloBoxesRaw && yoloBoxesRaw.length > 0) {
        adjustedBoxes = adjustYOLOBoxesForCrop(yoloBoxesRaw, crop, img.width, img.height)
      }

      return {
        finalSrc: croppedDataUrl,
        finalW: crop.width,
        finalH: crop.height,
        finalBoxes: adjustedBoxes,
      }
    }

    return {
      finalSrc: dataUrl,
      finalW: img.width,
      finalH: img.height,
      finalBoxes: yoloBoxesRaw || [],
    }
  }, [])

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    const imageFiles = fileList.filter((f) => /\.(png|jpe?g|bmp|webp|tiff?)$/i.test(f.name))
    const txtFiles = fileList.filter((f) => /\.txt$/i.test(f.name))

    const txtMap = new Map<string, string>()
    for (const tf of txtFiles) {
      const baseName = tf.name.replace(/\.txt$/i, '')
      txtMap.set(baseName, await tf.text())
    }

    const allUploaded: UploadedImage[] = []
    const skippedNames: string[] = []
    const existingNames = new Set(objects.filter(o => !o.maskData).map((o) => o.name.replace(/\s*\(\d+\)\s*$/, '').trim()))
    let isFirstLoaded = false

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.readAsDataURL(file)
      })

      const baseName = file.name.replace(/\.[^.]+$/, '')
      const checkName = baseName.replace(/\s*\(\d+\)\s*$/, '').trim()

      if (existingNames.has(checkName)) {
        skippedNames.push(baseName)
        continue
      }
      existingNames.add(checkName)
      let yoloRaw: YOLOBoxRaw[] | undefined
      const txtContent = txtMap.get(baseName)
      if (txtContent) {
        yoloRaw = parseYOLOTxt(txtContent)
      }

      if (!isFirstLoaded) {
        isFirstLoaded = true
        const { finalSrc, finalW, finalH, finalBoxes } = await processImageWithCropAndYOLO(dataUrl, baseName, yoloRaw)
        if (!newName) setNewName(baseName)
        pendingLoadRef.current = { finalSrc, finalW, finalH, finalBoxes, dataUrl, baseName }
        setPendingLoadVer((v) => v + 1)

        await addObject({
          name: baseName || '未命名异物',
          category: maskCat || '点状',
          thumbnail: await createThumbnail(finalSrc),
          originalImage: finalSrc,
          maskData: '',
          cutoutImage: finalSrc,
          yoloBoxes: finalBoxes,
        })
      } else {
        const { finalSrc, finalW, finalH, finalBoxes } = await processImageWithCropAndYOLO(dataUrl, baseName, yoloRaw)
        await addObject({
          name: baseName || '未命名异物',
          category: maskCat || '点状',
          thumbnail: await createThumbnail(finalSrc),
          originalImage: finalSrc,
          maskData: '',
          cutoutImage: finalSrc,
          yoloBoxes: finalBoxes,
        })
      }

      allUploaded.push({ dataUrl, name: baseName, yoloBoxes: yoloRaw })
    }

    if (allUploaded.length > 0) {
      setUploadedImages(allUploaded)
      onImagesUploaded(allUploaded)
    }
    if (skippedNames.length > 0) {
      alert(`以下 ${skippedNames.length} 个文件已存在，已跳过：\n${skippedNames.join('\n')}`)
    }
    e.target.value = ''
  }, [newName, maskCat, addObject, onImagesUploaded, processImageWithCropAndYOLO, objects])

  const createThumbnail = async (dataUrl: string): Promise<string> => {
    const img = await loadImage(dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const scale = Math.min(64 / img.width, 64 / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, (64 - dw) / 2, (64 - dh) / 2, dw, dh)
    return canvas.toDataURL('image/png')
  }

  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    }
  }, [zoom])

  const closePolygon = useCallback((closePos?: { isCloseClick?: boolean }) => {
    if (polygonPoints.length < 3) {
      setPolygonPoints([])
      setPolygonPreview(null)
      return
    }
    const maskCtx = maskCtxRef.current
    if (!maskCtx) return

    const pts = polygonPoints
    maskCtx.globalCompositeOperation = 'source-over'
    maskCtx.fillStyle = 'white'
    maskCtx.beginPath()
    maskCtx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      maskCtx.lineTo(pts[i].x, pts[i].y)
    }
    maskCtx.closePath()
    maskCtx.fill()

    const overlayCanvas = canvasRef.current
    if (overlayCanvas) {
      const overlayCtx = overlayCanvas.getContext('2d')!
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    }
    setPolygonPoints([])
    setPolygonPreview(null)
    refreshDisplay()
    updatePreviewFromMask()
    saveHistory()
  }, [polygonPoints, refreshDisplay, updatePreviewFromMask, saveHistory])

  const startDraw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (spaceHeld || isPanning) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
      return
    }
    if (tool === 'polygon') {
      if (!maskCtxRef.current) return
      const pos = getCanvasPos(e)
      const first = polygonPoints[0]
      if (polygonPoints.length >= 3 && first) {
        const dx = pos.x - first.x
        const dy = pos.y - first.y
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          closePolygon({ ...pos, isCloseClick: true })
          return
        }
      }
      setPolygonPoints((prev) => [...prev, pos])
      return
    }
    if (!maskCtxRef.current) return
    setIsDrawing(true)
    const pos = getCanvasPos(e)

    const maskCtx = maskCtxRef.current
    maskCtx.beginPath()
    maskCtx.moveTo(pos.x, pos.y)
    maskCtx.lineWidth = brushSize
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    if (tool === 'brush') {
      maskCtx.globalCompositeOperation = 'source-over'
      maskCtx.strokeStyle = 'white'
    } else {
      maskCtx.globalCompositeOperation = 'destination-out'
      maskCtx.strokeStyle = 'rgba(0,0,0,1)'
    }
    maskCtx.stroke()

    const overlayCanvas = canvasRef.current
    if (overlayCanvas) {
      overlayCanvas.width = imgSizeRef.current.width
      overlayCanvas.height = imgSizeRef.current.height
      overlayCanvas.style.width = imgSizeRef.current.width + 'px'
      overlayCanvas.style.height = imgSizeRef.current.height + 'px'
      const overlayCtx = overlayCanvas.getContext('2d')!
      overlayCtx.beginPath()
      overlayCtx.moveTo(pos.x, pos.y)
      overlayCtx.lineWidth = brushSize
      overlayCtx.lineCap = 'round'
      overlayCtx.lineJoin = 'round'
      overlayCtx.strokeStyle = tool === 'brush' ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'
      overlayCtx.stroke()
    }
  }, [tool, brushSize, getCanvasPos, spaceHeld, isPanning, polygonPoints, closePolygon])

  const onDraw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'polygon') {
      if (polygonPoints.length > 0 && !isPanning) {
        const pos = getCanvasPos(e)
        setPolygonPreview(pos)
      }
      if (isPanning) {
        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        })
      }
      return
    }
    if (!isDrawing && !isPanning) return
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
      return
    }
    if (!maskCtxRef.current) return
    const pos = getCanvasPos(e)
    maskCtxRef.current.lineTo(pos.x, pos.y)
    maskCtxRef.current.stroke()

    const overlayCanvas = canvasRef.current
    if (overlayCanvas) {
      const overlayCtx = overlayCanvas.getContext('2d')!
      overlayCtx.lineTo(pos.x, pos.y)
      overlayCtx.stroke()
    }
  }, [isDrawing, isPanning, getCanvasPos, panStart, tool, polygonPoints])

  const cancelPolygon = useCallback(() => {
    if (polygonPoints.length > 0) {
      const overlayCanvas = canvasRef.current
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d')!
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
      }
      setPolygonPoints([])
      setPolygonPreview(null)
    }
  }, [polygonPoints])

  const renderPolygonOverlay = useCallback(() => {
    const overlayCanvas = canvasRef.current
    if (!overlayCanvas) return
    const pts = polygonPoints
    if (pts.length === 0) return

    overlayCanvas.width = imgSizeRef.current.width
    overlayCanvas.height = imgSizeRef.current.height
    overlayCanvas.style.width = imgSizeRef.current.width + 'px'
    overlayCanvas.style.height = imgSizeRef.current.height + 'px'
    const overlayCtx = overlayCanvas.getContext('2d')!

    if (pts.length >= 3) {
      overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.15)'
      overlayCtx.beginPath()
      overlayCtx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        overlayCtx.lineTo(pts[i].x, pts[i].y)
      }
      overlayCtx.closePath()
      overlayCtx.fill()
    }

    overlayCtx.strokeStyle = 'rgba(34, 197, 94, 0.9)'
    overlayCtx.lineWidth = 2
    overlayCtx.setLineDash([4, 2])
    overlayCtx.beginPath()
    overlayCtx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      overlayCtx.lineTo(pts[i].x, pts[i].y)
    }
    if (polygonPreview) {
      overlayCtx.lineTo(polygonPreview.x, polygonPreview.y)
    }
    if (pts.length >= 3) {
      overlayCtx.lineTo(pts[0].x, pts[0].y)
    }
    overlayCtx.stroke()
    overlayCtx.setLineDash([])

    for (const pt of pts) {
      overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.9)'
      overlayCtx.beginPath()
      overlayCtx.arc(pt.x, pt.y, 3, 0, Math.PI * 2)
      overlayCtx.fill()
    }
    if (polygonPreview) {
      overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.5)'
      overlayCtx.beginPath()
      overlayCtx.arc(polygonPreview.x, polygonPreview.y, 3, 0, Math.PI * 2)
      overlayCtx.fill()
    }
  }, [polygonPoints, polygonPreview])

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'polygon') return
    e.preventDefault()
    closePolygon()
  }, [tool, closePolygon])

  const stopDraw = useCallback(() => {
    if (tool === 'polygon') {
      setIsPanning(false)
      return
    }
    if (isDrawing) {
      const overlayCanvas = canvasRef.current
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d')!
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
      }
      refreshDisplay()
      updatePreviewFromMask()
      saveHistory()
    }
    setIsDrawing(false)
    setIsPanning(false)
  }, [isDrawing, refreshDisplay, updatePreviewFromMask, saveHistory, tool])

  const loadUploadedImage = useCallback(async (uploaded: UploadedImage) => {
    const { finalSrc, finalW, finalH, finalBoxes } = await processImageWithCropAndYOLO(uploaded.dataUrl, uploaded.name, uploaded.yoloBoxes)
    const img = await loadImage(finalSrc)
    imgRef.current = img
    const iw = img.width
    const ih = img.height
    setImgSize({ width: iw, height: ih })
    imgSizeRef.current = { width: iw, height: ih }
    setOriginalSrc(finalSrc)
    rawUploadedUrlRef.current = uploaded.dataUrl
    setYoloBoxes(finalBoxes)
    setNewName(uploaded.name)
    setPanOffset({ x: 0, y: 0 })
    setZoom(1)
    setHistory([])
    setHistoryIdx(-1)

    const maskCanvas = maskCanvasRef.current
    if (maskCanvas) {
      maskCanvas.width = finalW
      maskCanvas.height = finalH
      const ctx = maskCanvas.getContext('2d')!
      maskCtxRef.current = ctx
      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    }

    refreshDisplay()
    saveHistory()
    updatePreviewFromMask()
  }, [refreshDisplay, saveHistory, updatePreviewFromMask, processImageWithCropAndYOLO])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceHeld(true)
        if (containerRef.current) {
          containerRef.current.style.cursor = 'grab'
        }
      }
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if (e.ctrlKey && (e.key === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
      if (tool === 'polygon') {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelPolygon()
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          closePolygon()
        }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false)
        if (containerRef.current) {
          containerRef.current.style.cursor = 'crosshair'
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [undo, redo, tool, cancelPolygon, closePolygon])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const z = zoomRef.current
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      const newZ = Math.max(0.25, Math.min(10, z + delta))
      if (newZ === z) return
      setZoom(newZ)
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [originalSrc])

  useEffect(() => {
    if (tool !== 'polygon') {
      cancelPolygon()
    }
  }, [tool])

  useEffect(() => {
    if (tool === 'polygon') {
      renderPolygonOverlay()
    }
  }, [polygonPoints, polygonPreview, tool, renderPolygonOverlay])

  const handleSave = useCallback(async () => {
    if (!originalSrc || !previewSrc || !imgRef.current) return

    let maskData = ''
    if (maskCanvasRef.current) {
      maskData = maskCanvasRef.current.toDataURL('image/png')
    }

    const thumbnail = await createThumbnail(previewSrc)

    if (editingId && editObjRef.current?.maskData) {
      await updateObject(editingId, {
        name: newName,
        category: maskCat,
        cutoutImage: previewSrc,
        maskData,
        thumbnail,
        originalImage: originalSrc,
        yoloBoxes,
      })
    } else {
      const baseName = (newName || '未命名异物').replace(/\s*\(\d+\)\s*$/, '').trim()
      const usedNums = new Set<number>()
      objects.forEach((o) => {
        if (o.originalImage === originalSrc && o.maskData) {
          const m = o.name.match(/\s*\((\d+)\)\s*$/)
          if (m) usedNums.add(parseInt(m[1]))
        }
      })
      let num = 1
      while (usedNums.has(num)) num++
      const autoName = `${baseName}(${num})`
      await addObject({
        name: autoName,
        category: maskCat || '点状',
        thumbnail,
        originalImage: originalSrc,
        maskData,
        cutoutImage: previewSrc,
        yoloBoxes,
      })
    }

    if (maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext('2d')!
      maskCtxRef.current = ctx
      ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height)
    }
    onImageProcessed(rawUploadedUrlRef.current)
    setHistory([])
    setHistoryIdx(-1)
    refreshDisplay()
    updatePreviewFromMask()
  }, [originalSrc, previewSrc, newName, maskCat, isNewMode, editingId, addObject, updateObject, yoloBoxes, refreshDisplay, updatePreviewFromMask, objects])

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">{isNewMode ? '新建异物素材' : '编辑异物素材'}</h2>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
        <div className="lg:col-span-2 card flex flex-col overflow-hidden">
          <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept="image/*,.txt" multiple onChange={handleUpload} className="hidden" />
            <input ref={folderInputRef} type="file" accept="image/*,.txt" multiple onChange={handleUpload} className="hidden" />
            <button
              onClick={() => setTool('brush')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                tool === 'brush' ? 'bg-primary-500 text-white' : 'btn-secondary'
              }`}
            >
              🖌 画笔
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                tool === 'eraser' ? 'bg-primary-500 text-white' : 'btn-secondary'
              }`}
            >
              🧹 橡皮
            </button>
            <button
              onClick={() => setTool('polygon')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                tool === 'polygon' ? 'bg-primary-500 text-white' : 'btn-secondary'
              }`}
            >
              📐 多边形
            </button>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
            <button
              onClick={undo}
              disabled={historyIdx <= 0}
              className="btn-secondary text-xs px-2 py-1.5 disabled:opacity-30"
              title="Ctrl+Z"
            >
              ↩ 撤销
            </button>
            <button
              onClick={redo}
              disabled={historyIdx >= history.length - 1}
              className="btn-secondary text-xs px-2 py-1.5 disabled:opacity-30"
              title="Ctrl+Shift+Z"
            >
              ↪ 重做
            </button>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-400">笔刷:</span>
            <input
              type="range"
              min="1"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-16"
            />
            <input
              type="number"
              min={1}
              max={50}
              value={brushSize}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 1 && v <= 50) setBrushSize(v)
              }}
              className="w-12 text-xs text-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            />
            <span className="text-xs text-gray-400">px</span>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
            <button onClick={() => {
              setZoom(1)
              setPanOffset({ x: 0, y: 0 })
              if (maskCanvasRef.current) {
                const ctx = maskCanvasRef.current.getContext('2d')!
                maskCtxRef.current = ctx
                ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height)
              }
              setHistory([])
              setHistoryIdx(-1)
              cancelPolygon()
              refreshDisplay()
              updatePreviewFromMask()
            }} className="btn-secondary text-xs px-2 py-1">重置画面</button>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
            <button onClick={() => setZoom((z) => Math.min(z + 0.25, 10))} className="btn-secondary text-xs px-2 py-1">🔍+</button>
            <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))} className="btn-secondary text-xs px-2 py-1">🔍-</button>
            <span className="text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
            <button
              onClick={handleSave}
              disabled={!originalSrc || !previewSrc}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-30"
            >
              保存到异物库
            </button>
          </div>

          <div
            ref={containerRef}
            className="flex-1 overflow-hidden bg-gray-100 dark:bg-gray-950 relative flex items-center justify-center"
            style={{ cursor: 'crosshair' }}
          >
            {!originalSrc && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="text-center text-gray-400">
                  <div className="text-4xl mb-2">📷</div>
                  <div className="text-sm">上传一张图片开始提取异物</div>
                  <div className="text-xs mt-1 text-gray-300 dark:text-gray-600">选择图片或文件夹批量导入</div>
                </div>
              </div>
            )}
            <div
              className="relative"
              style={{
                width: imgSize.width,
                height: imgSize.height,
                transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
                transformOrigin: 'center',
              }}
            >
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0"
                style={{ zIndex: 3, cursor: 'crosshair', width: imgSize.width, height: imgSize.height }}
                onMouseDown={startDraw}
                onMouseMove={onDraw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onDoubleClick={handleDoubleClick}
              />
              <canvas
                ref={displayCanvasRef}
                className="absolute top-0 left-0"
                style={{ zIndex: 1, width: imgSize.width, height: imgSize.height }}
              />
              <canvas
                ref={maskCanvasRef}
                className="absolute top-0 left-0"
                style={{ zIndex: 2, display: 'none', width: imgSize.width, height: imgSize.height }}
              />
              {imgRef.current && originalSrc && (
                <img
                  ref={imgRef}
                  src={originalSrc}
                  alt="原图"
                  style={{
                    width: imgSize.width,
                    height: imgSize.height,
                    display: 'block',
                  }}
                />
              )}
            </div>
          </div>

          <div className="text-xs text-gray-400 text-center py-1 border-t border-gray-200 dark:border-gray-800 flex items-center justify-center gap-3">
            {tool === 'polygon' ? (
              <>
                <span>📐 点击添加顶点</span>
                <span>🖱 双击/Enter 闭合</span>
                <span>Esc 取消</span>
              </>
            ) : (
              <>
                <span>🖌 画笔涂抹</span>
                <span>🧹 橡皮擦除</span>
              </>
            )}
            <span>⌨ 空格+拖动平移</span>
            <span>↩ Ctrl+Z 撤销</span>
            <span>↪ Ctrl+Shift+Z 重做</span>
            {yoloBoxes.length > 0 && (
              <span className="text-red-400">📦 已读取 {yoloBoxes.length} 个YOLO标注框</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="card p-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">异物名称</label>
            <div className="text-sm mt-1 text-gray-900 dark:text-gray-100 font-medium">{newName || '-'}</div>
          </div>
          <div className="card p-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">mask类别</label>
            <select
              value={showCustomCat ? '__custom__' : maskCat}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setShowCustomCat(true)
                  setCustomCatInput('')
                } else {
                  setMaskCat(e.target.value)
                  setShowCustomCat(false)
                }
              }}
              className="input-field text-sm mt-1"
            >
              {PRESET_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {customCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__custom__">自定义...</option>
            </select>
            {showCustomCat && (
              <div className="flex gap-1 mt-1">
                <input
                  type="text"
                  value={customCatInput}
                  onChange={(e) => setCustomCatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = customCatInput.trim()
                      if (v) {
                        setMaskCat(v)
                        if (!PRESET_CATEGORIES.includes(v)) {
                          setLocalCustomCategories((prev) => prev.includes(v) ? prev : [...prev, v])
                        }
                        setShowCustomCat(false)
                      }
                    }
                  }}
                  placeholder="输入自定义类别"
                  className="input-field text-sm flex-1"
                />
                <button
                  onClick={() => {
                    const v = customCatInput.trim()
                    if (v) {
                      setMaskCat(v)
                      if (!PRESET_CATEGORIES.includes(v)) {
                        setLocalCustomCategories((prev) => prev.includes(v) ? prev : [...prev, v])
                      }
                      setShowCustomCat(false)
                    }
                  }}
                  className="btn-primary text-xs px-2 py-1"
                >
                  确认
                </button>
              </div>
            )}
            {customCategories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {customCategories.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {c}
                    <button
                      onClick={() => {
                        const objsWithCat = objects.filter(o => o.category === c)
                        if (objsWithCat.length > 0) {
                          if (!window.confirm(`此操作将删除类别"${c}"下的全部 ${objsWithCat.length} 个异物，确定继续？`)) return
                          if (!window.confirm(`再次确认：永久删除这 ${objsWithCat.length} 个异物？此操作不可撤销。`)) return
                          removeObjects(objsWithCat.map(o => o.id))
                        }
                        setLocalCustomCategories((prev) => prev.filter((x) => x !== c))
                      }}
                      className="text-gray-400 hover:text-red-500"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="card p-3 flex-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">预览结果</label>
            <div className="flex gap-2 mb-2">
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">原图</div>
                <div className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center">
                  {originalSrc ? (
                    <img src={originalSrc} alt="原图" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-400 text-xs">-</span>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">异物预览</div>
                <div
                  className="aspect-square rounded-lg overflow-hidden flex items-center justify-center"
                  style={{
                    backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0, 6px 6px',
                  }}
                >
                  {previewSrc ? (
                    <img src={previewSrc} alt="抠图结果" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-400 text-xs">-</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
