import { useMemo, useState } from 'react'
import { useObjectStore } from '@/stores/objectStore'
import { exportMasksByCategory } from '@/utils/exportUtils'
import type { UploadedImage } from './ObjectEditor'

interface ObjectListProps {
  activeTab: 'pending' | 'all'
  onTabChange: (tab: 'pending' | 'all') => void
  pendingSelectedId: string | null
  onPendingSelect: (id: string) => void
  allSelectedId: string | null
  onAllSelect: (id: string) => void
  onUpload: () => void
  onFolderUpload: () => void
  onObjectsTabUpload: () => void
  onObjectsTabFolder: () => void
  sidebarImages: UploadedImage[]
  processedUrls: Set<string>
}

export default function ObjectList({
  activeTab, onTabChange,
  pendingSelectedId, onPendingSelect,
  allSelectedId, onAllSelect,
  onUpload, onFolderUpload,
  onObjectsTabUpload, onObjectsTabFolder,
  sidebarImages, processedUrls,
}: ObjectListProps) {
  const { objects, searchQuery, categoryFilter, setSearchQuery, setCategoryFilter, removeObject, updateObject } = useObjectStore()
  const [editingCatId, setEditingCatId] = useState<string | null>(null)

  const presetCategories = ['点状', '条状', '片状', '块状', '其他']

  const categories = useMemo(() => {
    const cats = new Set(objects.map((o) => o.category).filter(Boolean))
    return Array.from(cats)
  }, [objects])

  const pendingObjects = useMemo(() => {
    return objects.filter((o) => !o.maskData)
  }, [objects])

  const processedObjects = useMemo(() => {
    return objects.filter((o) => o.maskData)
  }, [objects])

  const filteredAll = useMemo(() => {
    return processedObjects.filter((o) => {
      if (searchQuery && !o.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (categoryFilter && o.category !== categoryFilter) return false
      return true
    })
  }, [processedObjects, searchQuery, categoryFilter])

  const savedBaseNames = useMemo(() => {
    const set = new Set<string>()
    for (const o of objects) {
      if (o.maskData) {
        const base = o.name.replace(/\s*\(\d+\)\s*$/, '').trim()
        set.add(base)
      }
    }
    return set
  }, [objects])

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2 border-b border-gray-200 dark:border-gray-800">
        <h2 className="panel-title">素材资源区</h2>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => onTabChange('pending')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'pending'
                ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            待处理图像 ({pendingObjects.length})
          </button>
          <button
            onClick={() => onTabChange('all')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'all'
                ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            异物库 ({processedObjects.length})
          </button>
        </div>

        {activeTab === 'all' && (
          <>
            <input
              type="text"
              placeholder="搜索异物..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field mb-2 text-sm"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'pending' && (
          <>
            <div className="text-xs text-gray-400 mb-1.5 font-medium">导入图片</div>
            <div className="flex gap-2 mb-3">
              <button onClick={onUpload} className="btn-secondary text-xs px-3 py-1.5 flex-1">
                上传原图
              </button>
              <button onClick={onFolderUpload} className="btn-secondary text-xs px-3 py-1.5 flex-1">
                导入文件夹
              </button>
            </div>

            {pendingObjects.length > 0 && (
              <>
                <div className="text-xs text-gray-400 mb-1.5 font-medium mt-2">待处理素材 ({pendingObjects.length})</div>
                {pendingObjects.map((obj) => (
                  <div
                    key={obj.id}
                    onClick={() => onPendingSelect(obj.id)}
                    className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer mb-1 transition-all ${
                      pendingSelectedId === obj.id
                        ? 'bg-primary-50 dark:bg-primary-950 ring-1 ring-primary-500'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-900'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0 flex items-center justify-center relative">
                      {obj.originalImage ? (
                        <img src={obj.originalImage} alt={obj.name} className="w-full h-full object-contain" />
                      ) : obj.thumbnail ? (
                        <img src={obj.thumbnail} alt={obj.name} className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-gray-400 text-xs">无图</span>
                      )}
                      {savedBaseNames.has(obj.name.replace(/\s*\(\d+\)\s*$/, '').trim()) && (
                        <div className="absolute top-0 left-0 w-4 h-4 rounded-br-md bg-green-500 text-white text-[10px] flex items-center justify-center">
                          ✓
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{obj.name}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-600">{formatDate(obj.createdAt)}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeObject(obj.id) }}
                      className="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3,6 5,6 21,6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </>
            )}

            {pendingObjects.length === 0 && (
              <div className="text-center text-gray-400 dark:text-gray-600 text-sm mt-8">
                请上传图片开始处理
              </div>
            )}
          </>
        )}

        {activeTab === 'all' && (
          <>
            <div className="text-xs text-gray-400 mb-1.5 font-medium">导入异物</div>
            <div className="flex gap-2 mb-3">
              <button onClick={onObjectsTabUpload} className="btn-secondary text-xs px-3 py-1.5 flex-1">
                上传单个异物
              </button>
              <button onClick={onObjectsTabFolder} className="btn-secondary text-xs px-3 py-1.5 flex-1">
                导入文件夹
              </button>
            </div>

            {filteredAll.length === 0 && (
              <div className="text-center text-gray-400 dark:text-gray-600 text-sm mt-8">
                {objects.length === 0 ? '暂无异物素材，请创建新的' : processedObjects.length === 0 ? '请在待处理图像中完成抠图' : '没有匹配的结果'}
              </div>
            )}
            {filteredAll.map((obj) => (
              <div
                key={obj.id}
                onClick={() => onAllSelect(obj.id)}
                className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer mb-1 transition-all ${
                  allSelectedId === obj.id
                    ? 'bg-primary-50 dark:bg-primary-950 ring-1 ring-primary-500'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-900'
                }`}
              >
                <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0 flex items-center justify-center relative">
                  {obj.thumbnail ? (
                    <img src={obj.thumbnail} alt={obj.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-400 text-xs">无图</span>
                  )}
                  <div className="absolute top-0 left-0 w-4 h-4 rounded-br-md bg-primary-500 text-white text-[10px] flex items-center justify-center">
                    ✓
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{obj.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 flex gap-2 items-center">
                    {editingCatId === obj.id ? (
                      <select
                        value={obj.category || ''}
                        autoFocus
                        className="text-xs border border-primary-400 rounded px-1 py-0 bg-white dark:bg-gray-800 max-w-[80px]"
                        onChange={(e) => {
                          updateObject(obj.id, { category: e.target.value })
                          setEditingCatId(null)
                        }}
                        onBlur={() => setEditingCatId(null)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {[...new Set([...presetCategories, ...categories])].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className="cursor-pointer hover:text-primary-500 border-b border-dotted border-gray-300 dark:border-gray-600"
                        onClick={(e) => { e.stopPropagation(); setEditingCatId(obj.id) }}
                        title="点击修改类别"
                      >
                        {obj.category || '点状'}
                      </span>
                    )}
                    <span>使用 {obj.usageCount || 0} 次</span>
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-600">{formatDate(obj.createdAt)}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeObject(obj.id) }}
                  className="text-gray-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,6 5,6 21,6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {activeTab === 'all' && filteredAll.length > 0 && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-between">
          <span>共 {processedObjects.length} 个</span>
          <button
            onClick={async () => {
              const blob = await exportMasksByCategory(objects)
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'masks_by_category.zip'
              a.click()
              URL.revokeObjectURL(url)
            }}
            disabled={processedObjects.length === 0}
            className="btn-primary text-xs px-2 py-1 disabled:opacity-30"
          >
            ⬇ 下载mask (ZIP)
          </button>
        </div>
      )}
    </div>
  )
}
