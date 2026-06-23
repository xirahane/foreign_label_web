import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatasetStore } from '@/stores/datasetStore'
import { useObjectStore } from '@/stores/objectStore'
import type { ExportFormat } from '@/types'

export default function DatasetConfig() {
  const { datasets, loadDatasets, createDataset, removeDataset, renameDataset } = useDatasetStore()
  const { objects, loadObjects } = useObjectStore()
  const navigate = useNavigate()

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [outputFormat, setOutputFormat] = useState<ExportFormat>('yolov8')
  const [editingDsId, setEditingDsId] = useState<string | null>(null)
  const [editingDsName, setEditingDsName] = useState('')

  useEffect(() => {
    loadDatasets()
    loadObjects()
  }, [])

  const handleCreate = async () => {
    if (!name.trim()) return
    const categories = new Set(objects.map((o) => o.category).filter(Boolean))
    const id = await createDataset({
      name: name.trim(),
      categoryCount: categories.size,
      outputFormat,
    })
    setName('')
    setShowForm(false)
    navigate('/generator', { state: { datasetId: id } })
  }

  const handleViewDataset = (id: string) => {
    navigate('/generator', { state: { datasetId: id } })
  }

  const startRename = (id: string, currentName: string) => {
    setEditingDsId(id)
    setEditingDsName(currentName)
  }

  const handleRename = async (id: string) => {
    if (editingDsName.trim()) {
      await renameDataset(id, editingDsName.trim())
    }
    setEditingDsId(null)
    setEditingDsName('')
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">数据集配置</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">创建和管理训练数据集</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            + 创建数据集
          </button>
        </div>

        {showForm && (
          <div className="card p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">新建数据集</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">数据集名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：PCB异物检测数据集"
                  className="input-field"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">输出格式</label>
                <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as ExportFormat)} className="input-field">
                  <option value="yolov5">YOLOv5</option>
                  <option value="yolov8">YOLOv8</option>
                  <option value="coco">COCO（预留）</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button onClick={handleCreate} disabled={!name.trim()} className="btn-primary">
                创建并进入生成器
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">取消</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {datasets.map((ds) => (
            <div key={ds.id} className="card p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => editingDsId !== ds.id && handleViewDataset(ds.id)}>
              <div className="flex items-start justify-between mb-3">
                {editingDsId === ds.id ? (
                  <input
                    type="text"
                    value={editingDsName}
                    onChange={(e) => setEditingDsName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(ds.id); if (e.key === 'Escape') { setEditingDsId(null); setEditingDsName('') } }}
                    onBlur={() => handleRename(ds.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="input-field text-sm font-semibold"
                    autoFocus
                  />
                ) : (
                  <h3 className="font-semibold text-sm">{ds.name}</h3>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400">
                  {ds.outputFormat.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
                <div>
                  <span className="block text-gray-400">图片</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{ds.generatedImages}</span>
                </div>
                <div>
                  <span className="block text-gray-400">标注</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{ds.labelCount}</span>
                </div>
                <div>
                  <span className="block text-gray-400">类别</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{ds.categoryCount}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{formatDate(ds.createdAt)}</span>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(ds.id, ds.name) }}
                    className="text-xs text-gray-400 hover:text-primary-500"
                  >
                    重命名
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeDataset(ds.id) }}
                    className="text-xs text-red-400 hover:text-red-500"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {datasets.length === 0 && !showForm && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-4">📦</div>
            <div className="text-lg mb-2">暂无数据集</div>
            <div className="text-sm">点击上方按钮创建第一个数据集</div>
          </div>
        )}
      </div>
    </div>
  )
}
