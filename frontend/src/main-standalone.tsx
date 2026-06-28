import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import ObjectLibrary from './components/ObjectLibrary/ObjectLibrary'
import { useObjectStore } from './stores/objectStore'
import { db } from './db/db'
import type { ForeignObject } from './types'
import './index.css'

const savedTheme = localStorage.getItem('theme') || 'light'
document.documentElement.classList.toggle('dark', savedTheme === 'dark')

function BackupBar() {
  const [autoBackup, setAutoBackup] = useState(() => localStorage.getItem('backup_auto') === '1')
  const [lastBackup, setLastBackup] = useState<string | null>(() => localStorage.getItem('backup_last'))
  const intervalRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const doBackup = useCallback(() => {
    const currentObjects = useObjectStore.getState().objects
    const data = JSON.stringify(currentObjects, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const now = new Date()
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
    const a = document.createElement('a')
    a.href = url
    a.download = `异物库备份_${ts}.json`
    a.click()
    URL.revokeObjectURL(url)
    const timeStr = new Date().toLocaleTimeString()
    setLastBackup(timeStr)
    localStorage.setItem('backup_last', timeStr)
  }, [])

  const toggleAutoBackup = useCallback(() => {
    setAutoBackup((prev) => {
      const next = !prev
      localStorage.setItem('backup_auto', next ? '1' : '0')
      return next
    })
  }, [])

  const handleRestore = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string
        const data = JSON.parse(text)
        if (!Array.isArray(data)) throw new Error('备份文件格式错误：应为数组')
        const required = ['id', 'name', 'category', 'originalImage']
        const invalid = data.filter((o: any) => required.some((k) => !(k in o)))
        if (invalid.length > 0) {
          alert(`备份文件中 ${invalid.length} 条记录缺少必要字段（需要: ${required.join(', ')}），请检查文件格式。`)
          return
        }

        const currentCount = useObjectStore.getState().objects.length
        if (!window.confirm(
          `即将用备份覆盖当前异物库！\n\n` +
          `当前异物库: ${currentCount} 个对象\n` +
          `备份文件: ${data.length} 个对象\n\n` +
          `确定要替换为备份数据吗？此操作不可撤销。`
        )) return

        await db.foreignObjects.clear()
        await db.foreignObjects.bulkPut(data as ForeignObject[])
        await useObjectStore.getState().loadObjects()
        alert(`已恢复到备份节点：${data.length} 个对象。`)
      } catch (err: any) {
        alert(`加载备份失败：${err.message}`)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  useEffect(() => {
    if (autoBackup) {
      doBackup()
      intervalRef.current = window.setInterval(doBackup, 10 * 60 * 1000)
    }
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [autoBackup, doBackup])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return (
    <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-1.5 flex items-center gap-3">
      <input ref={fileInputRef} type="file" accept=".json" onChange={handleRestore} className="hidden" />
      <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">💾 备份</span>
      <button onClick={doBackup} className="btn-secondary text-xs px-2 py-1">
        ⬇ 手动备份
      </button>
      <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-xs px-2 py-1">
        📂 加载备份
      </button>
      <button
        onClick={toggleAutoBackup}
        className={`text-xs px-2 py-1 rounded-lg font-medium transition-all ${
          autoBackup ? 'bg-green-500 text-white shadow-sm' : 'btn-secondary'
        }`}
      >
        {autoBackup ? '● 每10分钟' : '○ 自动备份'}
      </button>
      {autoBackup && lastBackup && (
        <span className="text-xs text-gray-400 dark:text-gray-500">上次: {lastBackup}</span>
      )}
      <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto">备份文件保存至浏览器下载目录</span>
    </div>
  )
}

function App() {
  const [theme, setTheme] = useState(savedTheme)

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-2">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold bg-gradient-to-r from-primary-500 to-purple-500 bg-clip-text text-transparent">
            异物标注工具
          </h1>
          <button onClick={toggleTheme} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>
      <BackupBar />
      <main className="flex-1 overflow-hidden">
        <ObjectLibrary />
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

