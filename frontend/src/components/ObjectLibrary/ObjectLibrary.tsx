import { useState, useCallback, useRef } from 'react'
import ObjectList from './ObjectList'
import ObjectEditor, { type UploadedImage } from './ObjectEditor'
import { useObjectStore } from '@/stores/objectStore'
import { loadImage } from '@/utils/imageProcessing'

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

  const addObject = useObjectStore((s) => s.addObject)

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

  const handleDirectImport = useCallback(async (files: FileList | null) => {
    if (!files) return
    const currentObjects = useObjectStore.getState().objects
    const existingNames = new Set(
      currentObjects.map((o) => o.name.replace(/\s*\(\d+\)\s*$/, '').trim())
    )
    const imageFiles = Array.from(files).filter(
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
        category: '点状',
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
        onChange={(e) => { handleDirectImport(e.target.files); e.target.value = '' }}
        className="hidden"
      />
      <input
        ref={objFolderInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => { handleDirectImport(e.target.files); e.target.value = '' }}
        className="hidden"
      />

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
