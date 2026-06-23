import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDatasetStore } from '@/stores/datasetStore'
import { useObjectStore } from '@/stores/objectStore'
import { exportDataset } from '@/utils/exportUtils'
import type { DatasetSample } from '@/types'

export default function DatasetManagement() {
  const location = useLocation()
  const navigate = useNavigate()
  const { datasets, currentDatasetId, currentSamples, selectDataset, loadDatasets, removeDataset, removeSample, addSamples, clearSamples } = useDatasetStore()
  const { objects } = useObjectStore()
  const [viewingSampleIdx, setViewingSampleIdx] = useState(0)
  const [imgScale, setImgScale] = useState(1)
  const [lastDeleted, setLastDeleted] = useState<Record<string, DatasetSample[]>>({})
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  useEffect(() => {
    loadDatasets()
    const state = location.state as { datasetId?: string }
    if (state?.datasetId) {
      selectDataset(state.datasetId)
    }
  }, [])

  const currentDataset = datasets.find((d) => d.id === currentDatasetId)
  const viewingSample = currentSamples[viewingSampleIdx]

  const categories = [...new Set(objects.map((o) => o.category).filter(Boolean))]

  const handleExport = async () => {
    if (!currentDataset || currentSamples.length === 0) return
    const blob = await exportDataset(currentSamples, categories, currentDataset.name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentDataset.name}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDeleteSample = useCallback(() => {
    if (viewingSample) {
      setLastDeleted((prev) => ({ ...prev, [currentDatasetId!]: [viewingSample] }))
      removeSample(viewingSample.id)
      if (viewingSampleIdx >= currentSamples.length - 1) {
        setViewingSampleIdx(Math.max(0, viewingSampleIdx - 1))
      }
    }
  }, [viewingSample, viewingSampleIdx, currentSamples.length, removeSample])

  const handleDeleteAll = useCallback(async () => {
    if (currentSamples.length === 0) return
    setLastDeleted((prev) => ({ ...prev, [currentDatasetId!]: [...currentSamples] }))
    await clearSamples()
    setViewingSampleIdx(0)
  }, [currentSamples, clearSamples])

  useEffect(() => {
    if (currentSamples.length > 0 && viewingSampleIdx >= currentSamples.length) {
      setViewingSampleIdx(Math.max(0, currentSamples.length - 1))
    }
  }, [currentSamples.length, viewingSampleIdx])

  const handleUndo = useCallback(async () => {
    if (!currentDatasetId) return
    const del = lastDeleted[currentDatasetId]
    if (!del || del.length === 0) return
    const toRestore = del.map(({ id, ...rest }) => rest)
    await addSamples(toRestore)
    setLastDeleted((prev) => { const next = { ...prev }; delete next[currentDatasetId]; return next })
  }, [lastDeleted, currentDatasetId, addSamples])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo])

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setImgScale(1)
  }, [viewingSampleIdx])

  useEffect(() => {
    const container = viewerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const img = imgRef.current
      if (!img) return
      const z = zoomRef.current
      const delta = e.deltaY > 0 ? -0.15 : 0.15
      const newZ = Math.max(0.3, Math.min(10, z + delta))
      if (newZ === z) return
      setZoom(newZ)
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [viewingSample])

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  if (!currentDatasetId) {
    return (
      <div className="h-full flex">
        <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 p-4 overflow-y-auto">
          <h2 className="panel-title">数据集列表</h2>
          {datasets.length === 0 ? (
            <div className="text-center text-gray-400 text-sm mt-8">暂无数据集</div>
          ) : (
            <div className="space-y-2">
              {datasets.map((ds) => (
                <div
                  key={ds.id}
                  onClick={() => selectDataset(ds.id)}
                  className={`card p-3 cursor-pointer transition-all ${
                    currentDatasetId === ds.id ? 'ring-2 ring-primary-500' : 'hover:shadow'
                  }`}
                >
                  <div className="font-medium text-sm">{ds.name}</div>
                  <div className="flex gap-3 text-xs text-gray-400 mt-1">
                    <span>{ds.generatedImages} 张图片</span>
                    <span>{ds.outputFormat.toUpperCase()}</span>
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(ds.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          选择一个数据集查看详情
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex">
      <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 p-4 overflow-y-auto">
        <h2 className="panel-title">数据集列表</h2>
        <div className="space-y-2">
          {datasets.map((ds) => (
            <div
              key={ds.id}
              onClick={() => selectDataset(ds.id)}
              className={`card p-3 cursor-pointer transition-all ${
                currentDatasetId === ds.id ? 'ring-2 ring-primary-500' : 'hover:shadow'
              }`}
            >
              <div className="font-medium text-sm">{ds.name}</div>
              <div className="flex gap-3 text-xs text-gray-400 mt-1">
                <span>{ds.generatedImages} 张图片</span>
                <span>{ds.outputFormat.toUpperCase()}</span>
              </div>
              <div className="text-xs text-gray-400">{formatDate(ds.createdAt)}</div>
              <button
                onClick={(e) => { e.stopPropagation(); removeDataset(ds.id) }}
                className="text-xs text-red-400 mt-1"
              >
                删除数据集
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{currentDataset?.name}</h2>
            <div className="flex gap-4 text-xs text-gray-500 mt-1">
              <span>图片: {currentDataset?.generatedImages}</span>
              <span>标注: {currentDataset?.labelCount}</span>
              <span>类别: {currentDataset?.categoryCount}</span>
              <span>格式: {currentDataset?.outputFormat.toUpperCase()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastDeleted[currentDatasetId!] && lastDeleted[currentDatasetId!].length > 0 && (
              <button onClick={handleUndo} className="btn-danger text-xs">
                ↩ 撤销删除 ({lastDeleted[currentDatasetId!].length})
              </button>
            )}
            <button
              onClick={() => navigate('/generator')}
              className="btn-secondary text-xs"
            >
              继续生成
            </button>
            <button
              onClick={handleExport}
              disabled={currentSamples.length === 0}
              className="btn-primary text-xs"
            >
              📦 导出 ZIP
            </button>
          </div>
        </div>

        {currentSamples.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            暂无生成样本，请前往生成器创建
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div
              ref={viewerRef}
              className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950 overflow-hidden p-4 cursor-grab"
              onMouseDown={(e) => {
                setDragging(true)
                setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
              }}
              onMouseMove={(e) => {
                if (dragging) {
                  setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
                }
              }}
              onMouseUp={() => setDragging(false)}
              onMouseLeave={() => setDragging(false)}
            >
              {viewingSample && (
                <div
                  className="relative"
                  style={{
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    transformOrigin: 'center',
                  }}
                >
                  <img
                    ref={imgRef}
                    src={viewingSample.imageData}
                    alt={`样本 ${viewingSampleIdx + 1}`}
                    className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
                    onLoad={(e) => {
                      const img = e.currentTarget
                      const naturalW = img.naturalWidth
                      const displayW = img.clientWidth
                      if (naturalW && displayW) {
                        setImgScale(displayW / naturalW)
                      }
                    }}
                    draggable={false}
                  />
                  {viewingSample.annotations.map((ann, i) => {
                    const s = imgScale || 1
                    const imgArea = (imgRef.current?.naturalWidth || 1) * (imgRef.current?.naturalHeight || 1)
                    const minArea = imgArea * 0.001
                    let annW = ann.width
                    let annH = ann.height
                    if (annW * annH < minArea) {
                      const scaleFactor = Math.sqrt(minArea / (annW * annH))
                      annW *= scaleFactor
                      annH *= scaleFactor
                    }
                    return (
                      <div
                        key={i}
                        className="absolute border-2 border-primary-500 bg-primary-500/10"
                        style={{
                          left: `${(ann.centerX - annW / 2) * s}px`,
                          top: `${(ann.centerY - annH / 2) * s}px`,
                          width: `${annW * s}px`,
                          height: `${annH * s}px`,
                        }}
                      >
                        <span className="absolute -top-5 left-0 text-xs bg-primary-500 text-white px-1 rounded whitespace-nowrap">
                          0
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 p-3 border-t border-gray-200 dark:border-gray-800 justify-center">
              <button onClick={() => setZoom((z) => Math.min(z + 0.25, 10))} className="btn-secondary text-xs px-2 py-1">🔍+</button>
              <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.3))} className="btn-secondary text-xs px-2 py-1">🔍-</button>
              <span className="text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
              <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
              <button
                onClick={() => setViewingSampleIdx((i) => Math.max(0, i - 1))}
                disabled={viewingSampleIdx === 0}
                className="btn-secondary text-xs px-3 py-1"
              >
                ← 上一个
              </button>
              <span className="text-xs text-gray-500 tabular-nums mx-2">
                {viewingSampleIdx + 1} / {currentSamples.length}
              </span>
              <button
                onClick={() => setViewingSampleIdx((i) => Math.min(currentSamples.length - 1, i + 1))}
                disabled={viewingSampleIdx === currentSamples.length - 1}
                className="btn-secondary text-xs px-3 py-1"
              >
                下一个 →
              </button>
              <button
                onClick={handleDeleteSample}
                className="btn-danger text-xs px-3 py-1 ml-4"
              >
                删除样本
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={currentSamples.length === 0}
                className="btn-danger text-xs px-3 py-1"
              >
                删除全部
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
