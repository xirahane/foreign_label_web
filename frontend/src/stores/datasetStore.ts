import { create } from 'zustand'
import { db } from '@/db/db'
import type { Dataset, DatasetSample, GenerationParams } from '@/types'

interface DatasetStore {
  datasets: Dataset[]
  currentDatasetId: string | null
  currentSamples: DatasetSample[]
  params: GenerationParams
  loading: boolean
  loadDatasets: () => Promise<void>
  createDataset: (data: Pick<Dataset, 'name' | 'categoryCount' | 'outputFormat' | 'imageSize'>) => Promise<string>
  removeDataset: (id: string) => Promise<void>
  selectDataset: (id: string) => Promise<void>
  loadSamples: (datasetId: string) => Promise<void>
  addSamples: (samples: Omit<DatasetSample, 'id'>[]) => Promise<void>
  removeSample: (id: string) => Promise<void>
  updateParams: (updates: Partial<GenerationParams>) => void
  resetParams: () => void
}

const defaultParams: GenerationParams = {
  objectCountMin: 1,
  objectCountMax: 5,
  scaleMin: 50,
  scaleMax: 150,
  rotationMin: 0,
  rotationMax: 360,
  opacityVariance: false,
  blurVariance: false,
  brightnessVariance: false,
  contrastVariance: false,
  edgeBlendStrength: 50,
  blendMode: 'feather',
  bboxStrategy: 'tight',
  bboxExpandRatio: 10,
  perClassStrategies: {},
  totalCount: 10,
  namingRule: 'image_{index}',
  exportFormat: 'yolov8',
  edgeMargin: 20,
}

export const useDatasetStore = create<DatasetStore>((set, get) => ({
  datasets: [],
  currentDatasetId: null,
  currentSamples: [],
  params: { ...defaultParams },
  loading: false,

  loadDatasets: async () => {
    set({ loading: true })
    const datasets = await db.datasets.orderBy('createdAt').reverse().toArray()
    set({ datasets, loading: false })
  },

  createDataset: async (data) => {
    const dataset: Dataset = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      generatedImages: 0,
      labelCount: 0,
    }
    await db.datasets.put(dataset)
    await get().loadDatasets()
    return dataset.id
  },

  removeDataset: async (id) => {
    await db.datasets.delete(id)
    await db.datasetSamples.where('datasetId').equals(id).delete()
    if (get().currentDatasetId === id) set({ currentDatasetId: null, currentSamples: [] })
    await get().loadDatasets()
  },

  selectDataset: async (id) => {
    set({ currentDatasetId: id })
    await get().loadSamples(id)
  },

  loadSamples: async (datasetId) => {
    const samples = await db.datasetSamples.where('datasetId').equals(datasetId).toArray()
    set({ currentSamples: samples })
  },

  addSamples: async (samples) => {
    const entries: DatasetSample[] = samples.map((s) => ({
      ...s,
      id: crypto.randomUUID(),
    }))
    await db.datasetSamples.bulkPut(entries)
    const dsId = get().currentDatasetId
    if (dsId) {
      await get().loadSamples(dsId)
      const count = await db.datasetSamples.where('datasetId').equals(dsId).count()
      await db.datasets.update(dsId, { generatedImages: count, labelCount: count })
      await get().loadDatasets()
    }
  },

  removeSample: async (id) => {
    await db.datasetSamples.delete(id)
    const dsId = get().currentDatasetId
    if (dsId) {
      await get().loadSamples(dsId)
      const count = await db.datasetSamples.where('datasetId').equals(dsId).count()
      await db.datasets.update(dsId, { generatedImages: count, labelCount: count })
      await get().loadDatasets()
    }
  },

  updateParams: (updates) => set((s) => ({ params: { ...s.params, ...updates } })),

  resetParams: () => set({ params: { ...defaultParams } }),
}))
