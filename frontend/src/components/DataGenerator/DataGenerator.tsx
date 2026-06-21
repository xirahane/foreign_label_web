import { useState, useCallback } from 'react'
import { useDatasetStore } from '@/stores/datasetStore'
import ResourcePanel from './ResourcePanel'
import PreviewCanvas from './PreviewCanvas'
import ParamPanel from './ParamPanel'

export default function DataGenerator() {
  const { datasets, currentDatasetId, selectDataset } = useDatasetStore()
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(300)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)

  const [currentBgId, setCurrentBgId] = useState<string | null>(null)
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')

  const handleSelectBg = useCallback((id: string) => {
    setCurrentBgId((prev) => (prev === id ? null : id))
  }, [])

  const handleToggleObject = useCallback((id: string) => {
    setSelectedObjectIds((prev) =>
      prev.includes(id) ? prev.filter((oid) => oid !== id) : [...prev, id]
    )
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDraggingLeft) {
      setLeftWidth(Math.max(200, Math.min(400, e.clientX - 40)))
    }
    if (isDraggingRight) {
      setRightWidth(Math.max(240, Math.min(450, window.innerWidth - e.clientX - 40)))
    }
  }, [isDraggingLeft, isDraggingRight])

  const stopDrag = useCallback(() => {
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
  }, [])

  if (!currentDatasetId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-400">
          <div className="text-5xl mb-4">⚙️</div>
          <div className="text-lg mb-2">未选择数据集</div>
          <div className="text-sm mb-4">请先在"数据集配置"页面创建或选择一个数据集</div>
          <select
            className="input-field w-64"
            value=""
            onChange={(e) => selectDataset(e.target.value)}
          >
            <option value="">-- 选择数据集 --</option>
            {datasets.map((ds) => (
              <option key={ds.id} value={ds.id}>{ds.name}</option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-full select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div style={{ width: leftWidth }} className="flex-shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-hidden relative">
        <ResourcePanel
          currentBgId={currentBgId}
          onSelectBg={handleSelectBg}
          selectedObjectIds={selectedObjectIds}
          onToggleObject={handleToggleObject}
          mode={mode}
        />
      </div>

      <div
        className="w-1 flex-shrink-0 bg-transparent hover:bg-primary-500 cursor-col-resize transition-colors relative z-10"
        onMouseDown={() => setIsDraggingLeft(true)}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => setMode('auto')}
              className={`px-2.5 py-1 rounded text-xs transition-all ${
                mode === 'auto' ? 'bg-primary-500 text-white' : 'btn-secondary'
              }`}
            >
              自动模式
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`px-2.5 py-1 rounded text-xs transition-all ${
                mode === 'manual' ? 'bg-primary-500 text-white' : 'btn-secondary'
              }`}
            >
              手动模式
            </button>
          </div>
          <span className="text-xs text-gray-400">
            {mode === 'auto'
              ? '自动随机放置异物，点击左侧异物可多选限定范围'
              : '拖拽异物到画布上手动摆放'}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <PreviewCanvas
            currentBgId={currentBgId}
            selectedObjectIds={selectedObjectIds}
            mode={mode}
          />
        </div>
      </div>

      <div
        className="w-1 flex-shrink-0 bg-transparent hover:bg-primary-500 cursor-col-resize transition-colors relative z-10"
        onMouseDown={() => setIsDraggingRight(true)}
      />

      <div style={{ width: rightWidth }} className="flex-shrink-0 border-l border-gray-200 dark:border-gray-800 overflow-hidden">
        <ParamPanel />
      </div>
    </div>
  )
}
