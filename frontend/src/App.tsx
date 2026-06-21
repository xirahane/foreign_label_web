import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import Layout from './components/Layout'
import ObjectLibrary from './components/ObjectLibrary/ObjectLibrary'
import DatasetConfig from './components/DatasetConfig/DatasetConfig'
import DataGenerator from './components/DataGenerator/DataGenerator'
import DatasetManagement from './components/DatasetManagement/DatasetManagement'
import { useObjectStore } from './stores/objectStore'
import { useBackgroundStore } from './stores/backgroundStore'
import { useDatasetStore } from './stores/datasetStore'

export default function App() {
  const loadObjects = useObjectStore((s) => s.loadObjects)
  const loadBackgrounds = useBackgroundStore((s) => s.loadBackgrounds)
  const loadDatasets = useDatasetStore((s) => s.loadDatasets)

  useEffect(() => {
    loadObjects()
    loadBackgrounds()
    loadDatasets()
  }, [])

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<ObjectLibrary />} />
        <Route path="/config" element={<DatasetConfig />} />
        <Route path="/generator" element={<DataGenerator />} />
        <Route path="/management" element={<DatasetManagement />} />
      </Routes>
    </Layout>
  )
}
