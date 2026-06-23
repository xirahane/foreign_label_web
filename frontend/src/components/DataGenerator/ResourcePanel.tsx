import { useState, useCallback, useRef, useEffect } from 'react'
import { useBackgroundStore } from '@/stores/backgroundStore'
import { useDatasetStore } from '@/stores/datasetStore'
import { useObjectStore } from '@/stores/objectStore'
import { parseYOLOTxt } from '@/utils/imageProcessing'
import type { YOLOBoxRaw } from '@/types'

interface ResourcePanelProps {
  currentBgId: string | null
  onSelectBg: (id: string) => void
  selectedObjectIds: string[]
  onToggleObject: (id: string) => void
  onSelectAllObjs: () => void
  onDeselectAllObjs: () => void
  mode: 'auto' | 'manual'
}

export default function ResourcePanel({
  currentBgId,
  onSelectBg,
  selectedObjectIds,
  onToggleObject,
  onSelectAllObjs,
  onDeselectAllObjs,
  mode,
}: ResourcePanelProps) {
  const { backgrounds, addBackground, removeBackground } = useBackgroundStore()
  const currentDatasetId = useDatasetStore((s) => s.currentDatasetId)
  const { objects } = useObjectStore()
  const [bgSearch, setBgSearch] = useState('')
  const [objSearch, setObjSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'backgrounds' | 'objects'>('backgrounds')
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (folderInputRef.current) {
      ;(folderInputRef.current as any).webkitdirectory = true
    }
  })

  const handleBgUpload = useCallback((files: FileList | null) => {
    if (!files) return
    const fileList = Array.from(files)
    const imageFiles = fileList.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|bmp|webp)$/i.test(f.name))
    const txtFiles = fileList.filter((f) => f.name.endsWith('.txt'))

    if (imageFiles.length === 0) return

    const currentBgs = useBackgroundStore.getState().backgrounds
    const datasetId = useDatasetStore.getState().currentDatasetId
    const datasetBgs = currentBgs.filter((b) => !b.datasetId || b.datasetId === datasetId)
    const existingNames = new Set(datasetBgs.map((b) => b.name.replace(/\s*\(\d+\)\s*$/, '').trim()))
    const skippedNames: string[] = []

    const txtMap = new Map<string, YOLOBoxRaw[]>()
    Promise.all(txtFiles.map(async (tf) => {
      const text = await tf.text()
      const baseName = tf.name.replace(/\.txt$/i, '')
      txtMap.set(baseName, parseYOLOTxt(text))
    })).then(() => {
      imageFiles.forEach((file) => {
        if (!file.type.startsWith('image/') && !/\.(png|jpe?g|bmp|webp)$/i.test(file.name)) return
        const baseName = file.name.replace(/\.[^.]+$/, '')
        const checkName = baseName.replace(/\s*\(\d+\)\s*$/, '').trim()
        if (existingNames.has(checkName)) {
          skippedNames.push(baseName)
          return
        }
        existingNames.add(checkName)
        const reader = new FileReader()
        reader.onload = (ev) => {
          const img = new Image()
          img.onload = () => {
            addBackground({
              name: baseName,
              dataUrl: ev.target?.result as string,
              width: img.width,
              height: img.height,
              datasetId: datasetId || undefined,
              yoloBoxes: txtMap.get(baseName),
            })
          }
          img.src = ev.target?.result as string
        }
        reader.readAsDataURL(file)
      })
      if (skippedNames.length > 0) {
        alert(`以下 ${skippedNames.length} 个背景已存在，已跳过：\n${skippedNames.join('\n')}`)
      }
    })
  }, [addBackground])

  const datasetBgs = backgrounds.filter((b) => !b.datasetId || b.datasetId === currentDatasetId)

  const filteredBgs = datasetBgs.filter((b) =>
    b.name.toLowerCase().includes(bgSearch.toLowerCase())
  )

  const processedObjs = objects.filter((o) => o.maskData && o.cutoutImage)

  const filteredObjs = processedObjs.filter((o) =>
    o.name.toLowerCase().includes(objSearch.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2 border-b border-gray-200 dark:border-gray-800">
        <h2 className="panel-title">素材资源区</h2>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setActiveTab('backgrounds')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'backgrounds'
                ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            背景图 ({datasetBgs.length})
          </button>
          <button
            onClick={() => setActiveTab('objects')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'objects'
                ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            异物库 ({processedObjs.length})
          </button>
        </div>
        {activeTab === 'objects' && (
          <input
            type="text"
            placeholder="搜索异物..."
            value={objSearch}
            onChange={(e) => setObjSearch(e.target.value)}
            className="input-field text-sm"
          />
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'backgrounds' && (
          <div className="flex flex-col h-full">
            <div className="px-3 py-2 space-y-2">
              <input
                type="text"
                placeholder="搜索背景图..."
                value={bgSearch}
                onChange={(e) => setBgSearch(e.target.value)}
                className="input-field text-sm"
              />
              <label className="block btn-secondary text-xs px-3 py-1.5 cursor-pointer text-center">
                上传背景图
                 <input type="file" accept="image/*,.txt" multiple onChange={(e) => handleBgUpload(e.target.files)} className="hidden" />
              </label>
              <label className="block btn-secondary text-xs px-3 py-1.5 cursor-pointer text-center">
                导入背景文件夹
                <input
                  ref={folderInputRef}
                  type="file"
                  accept="image/*,.txt"
                  multiple
                  onChange={(e) => handleBgUpload(e.target.files)}
                  className="hidden"
                />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 auto-rows-max">
              {filteredBgs.map((bg) => (
                <div
                  key={bg.id}
                  onClick={() => onSelectBg(bg.id)}
                  className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                    currentBgId === bg.id
                      ? 'border-primary-500 shadow-md shadow-primary-500/20'
                      : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="aspect-video bg-gray-100 dark:bg-gray-800">
                    <img src={bg.dataUrl} alt={bg.name} className="w-full h-full object-contain" />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1 px-1">{bg.name}</div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeBackground(bg.id) }}
                    className="absolute top-1 right-1 w-5 h-5 rounded bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                  {currentBgId === bg.id && (
                    <div className="absolute top-1 left-1 w-5 h-5 rounded bg-primary-500 text-white text-xs flex items-center justify-center">
                      ✓
                    </div>
                  )}
                </div>
              ))}
              {filteredBgs.length === 0 && (
                <div className="col-span-2 text-center text-xs text-gray-400 py-8">
                  {datasetBgs.length === 0 ? '暂无背景图，点击上传' : '没有匹配结果'}
                </div>
              )}
            </div>
            {filteredBgs.length > 0 && (
              <div className="p-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-between">
                <span>共 {datasetBgs.length} 张背景图</span>
              </div>
            )}
          </div>
        )}

        {activeTab === 'objects' && (
          <div className="flex flex-col h-full">
            <div className="px-3 py-2 flex gap-2">
              <button onClick={onSelectAllObjs} className="btn-secondary text-xs px-2 py-1 flex-1">
                全选
              </button>
              <button onClick={onDeselectAllObjs} className="btn-secondary text-xs px-2 py-1 flex-1">
                取消全选
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {filteredObjs.map((obj) => {
                const isSelected = selectedObjectIds.includes(obj.id)
                return (
                  <div
                    key={obj.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('objectId', obj.id)
                    }}
                    onClick={() => mode === 'auto' && onToggleObject(obj.id)}
                    className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer mb-1 transition-all ${
                      isSelected
                        ? 'bg-primary-50 dark:bg-primary-950 ring-1 ring-primary-500'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-900'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {obj.thumbnail ? (
                        <img src={obj.thumbnail} alt={obj.name} className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-gray-400 text-xs">无图</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{obj.name}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{obj.category}</div>
                    </div>
                    {isSelected && (
                      <span className="text-primary-500 text-xs">✓</span>
                    )}
                  </div>
                )
              })}
              {filteredObjs.length === 0 && (
                <div className="text-center text-sm text-gray-400 dark:text-gray-600 mt-8">
                  {processedObjs.length === 0 ? '暂无异物素材，请在异物库管理中完成抠图' : '没有匹配的结果'}
                </div>
              )}
            </div>
            {filteredObjs.length > 0 && (
              <div className="p-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-between">
                <span>共 {processedObjs.length} 个异物</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
