import { useState, useCallback, useRef, useMemo } from 'react'
import ObjectList from './ObjectList'
import ObjectEditor, { type UploadedImage } from './ObjectEditor'
import { useObjectStore } from '@/stores/objectStore'
import { loadImage } from '@/utils/imageProcessing'

const PRESET_CATEGORIES = ['点状', '条状', '片状', '块状', '其他']

function createThumbnail(img: HTMLImageElement, maxSize: number): string {
  const canvas = document.createElement('canvas')
  let w = img.width, h = img.height
  if (w > h) { if (w > maxSize) { h = (h / w) * maxSize; w = maxSize } }
  else { if (h > maxSize) { w = (w / h) * maxSize; h = maxSize } }
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png')
}

function createFullMask(w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  return canvas.toDataURL('image/png')
}

export default function ObjectLibrary() {
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending')
  const [pendingEditingId, setPendingEditingId] = useState<string | null>(null)
  const [allEditingId, setAllEditingId] = useState<string | null>(null)
  const [sidebarImages, setSidebarImages] = useState<UploadedImage[]>([])
  const [processedUrls, setProcessedUrls] = useState<Set<string>>(new Set())
  const [uploadTrigger, setUploadTrigger] = useState(0)
  const [folderTrigger, setFolderTrigger] = useState(0)

  const [showCatModal, setShowCatModal] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [tempCat, setTempCat] = useState('点状')
  const [tempCustomCat, setTempCustomCat] = useState('')

  const addObject = useObjectStore((s) => s.addObject)
  const objects = useObjectStore((s) => s.objects)

  const storeCustomCategories = useMemo(() => {
    const cats = new Set(objects.map((o) => o.category).filter(Boolean))
    PRESET_CATEGORIES.forEach((c) => cats.delete(c))
    return Array.from(cats).sort()
  }, [objects])

  const objFileInputRef = useRef<HTMLInputElement>(null!)
  const objFolderInputRef = useRef<HTMLInputElement>(null!)

  const handleSelect = useCallback((id: string) => {
    if (activeTab === 'pending') {
      setPendingEditingId(id)
    } else {
      setAllEditingId(id)
    }
    setSidebarImages([])
  }, [activeTab])

  const triggerUpload = useCallback(() => setUploadTrigger((n) => n + 1), [])
  const triggerFolder = useCallback(() => setFolderTrigger((n) => n + 1), [])

  const handleDirectImport = useCallback(async (files: File[], category: string) => {
    const currentObjects = useObjectStore.getState().objects
    const existingNames = new Set(
      currentObjects.map((o) => o.name.replace(/\s*\(\d+\)\s*$/, '').trim())
    )
    const imageFiles = files.filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|bmp|webp)$/i.test(f.name)
    )
    const skippedNames: string[] = []

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]
      const baseName = file.name.replace(/\.[^.]+$/, '')
      const checkName = baseName.replace(/\s*\(\d+\)\s*$/, '').trim()

      if (existingNames.has(checkName)) {
        skippedNames.push(baseName)
        continue
      }
      existingNames.add(checkName)

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = (ev) => resolve(ev.target?.result as string)
        reader.readAsDataURL(file)
      })
      const img = await loadImage(dataUrl)
      const thumb = createThumbnail(img, 200)
      const mask = createFullMask(img.width, img.height)
      addObject({
        name: baseName,
        category,
        originalImage: dataUrl,
        thumbnail: thumb,
        maskData: mask,
        cutoutImage: dataUrl,
      })
    }

    if (skippedNames.length > 0) {
      alert(`以下 ${skippedNames.length} 个文件已存在，已跳过：\n${skippedNames.join('\n')}`)
    }
  }, [addObject])

  const handleObjFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      setPendingFiles(Array.from(files))
      setTempCat('点状')
      setTempCustomCat('')
      setShowCatModal(true)
    }
  }, [])

  const handleObjFolderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      setPendingFiles(Array.from(files))
      setTempCat('点状')
      setTempCustomCat('')
      setShowCatModal(true)
    }
  }, [])

  const handleConfirmImport = useCallback(() => {
    const cat = tempCustomCat.trim() || tempCat
    if (pendingFiles.length > 0) {
      handleDirectImport(pendingFiles, cat)
    }
    setShowCatModal(false)
    setPendingFiles([])
    if (objFileInputRef.current) objFileInputRef.current.value = ''
    if (objFolderInputRef.current) objFolderInputRef.current.value = ''
  }, [tempCat, tempCustomCat, pendingFiles, handleDirectImport])

  const handleCancelImport = useCallback(() => {
    setShowCatModal(false)
    setPendingFiles([])
    if (objFileInputRef.current) objFileInputRef.current.value = ''
    if (objFolderInputRef.current) objFolderInputRef.current.value = ''
  }, [])

  const handleObjectsTabUpload = useCallback(() => {
    objFileInputRef.current?.click()
  }, [])

  const handleObjectsTabFolder = useCallback(() => {
    if (!objFolderInputRef.current) return
    ;(objFolderInputRef.current as any).webkitdirectory = true
    objFolderInputRef.current.click()
  }, [])

  const handleImageProcessed = useCallback((dataUrl: string) => {
    setProcessedUrls((prev) => new Set(prev).add(dataUrl))
  }, [])

  return (
    <div className="flex h-full">
      <input
        ref={objFileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleObjFileChange}
        className="hidden"
      />
      <input
        ref={objFolderInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleObjFolderChange}
        className="hidden"
      />

      {showCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card p-6 w-96 max-w-[90vw] shadow-xl">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              选择异物类别
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              已选 {pendingFiles.length} 个文件，将为它们统一分配类别
            </p>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {PRESET_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => { setTempCat(cat); setTempCustomCat('') }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    tempCat === cat && !tempCustomCat
                      ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {storeCustomCategories.length > 0 && (
              <>
                <div className="text-xs text-gray-400 mb-2">已自定义类别</div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {storeCustomCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => { setTempCat(cat); setTempCustomCat('') }}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                        tempCat === cat && !tempCustomCat
                          ? 'bg-primary-500 text-white shadow-md shadow-primary-500/25'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mb-4">
              <div className="text-xs text-gray-400 mb-1">或输入新类别</div>
              <input
                type="text"
                value={tempCustomCat}
                onChange={(e) => { setTempCustomCat(e.target.value); setTempCat('') }}
                onFocus={() => setTempCat('')}
                placeholder="自定义类别名称..."
                className="input-field text-sm"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={handleCancelImport} className="btn-secondary text-sm">
                取消
              </button>
              <button onClick={handleConfirmImport} className="btn-primary text-sm">
                确认导入 ({pendingFiles.length} 个)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-hidden">
        <ObjectList
          activeTab={activeTab}
          onTabChange={setActiveTab}
          pendingSelectedId={pendingEditingId}
          onPendingSelect={setPendingEditingId}
          allSelectedId={allEditingId}
          onAllSelect={setAllEditingId}
          onUpload={triggerUpload}
          onFolderUpload={triggerFolder}
          onObjectsTabUpload={handleObjectsTabUpload}
          onObjectsTabFolder={handleObjectsTabFolder}
          sidebarImages={sidebarImages}
          processedUrls={processedUrls}
        />
      </div>

      <div style={{ display: activeTab === 'pending' ? 'flex' : 'none' }} className="flex-1 overflow-hidden">
        <ObjectEditor
          editingId={pendingEditingId}
          onNew={() => setPendingEditingId(null)}
          uploadTrigger={uploadTrigger}
          folderTrigger={folderTrigger}
          onImagesUploaded={setSidebarImages}
          onImageProcessed={handleImageProcessed}
        />
      </div>

      <div style={{ display: activeTab === 'all' ? 'flex' : 'none' }} className="flex-1 overflow-hidden">
        <ObjectEditor
          editingId={allEditingId}
          onNew={() => setAllEditingId(null)}
          uploadTrigger={0}
          folderTrigger={0}
          onImagesUploaded={() => {}}
          onImageProcessed={handleImageProcessed}
        />
      </div>
    </div>
  )
}
