import { useState, useCallback } from 'react'
import ObjectList from './ObjectList'
import ObjectEditor, { type UploadedImage } from './ObjectEditor'

export default function ObjectLibrary() {
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending')
  const [pendingEditingId, setPendingEditingId] = useState<string | null>(null)
  const [allEditingId, setAllEditingId] = useState<string | null>(null)
  const [sidebarImages, setSidebarImages] = useState<UploadedImage[]>([])
  const [processedUrls, setProcessedUrls] = useState<Set<string>>(new Set())
  const [uploadTrigger, setUploadTrigger] = useState(0)
  const [folderTrigger, setFolderTrigger] = useState(0)

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

  const handleImageProcessed = useCallback((dataUrl: string) => {
    setProcessedUrls((prev) => new Set(prev).add(dataUrl))
  }, [])

  return (
    <div className="flex h-full">
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
