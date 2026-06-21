import Dexie, { type Table } from 'dexie'
import type { ForeignObject, BackgroundImage, Dataset, DatasetSample } from '@/types'

class AppDatabase extends Dexie {
  foreignObjects!: Table<ForeignObject, string>
  backgroundImages!: Table<BackgroundImage, string>
  datasets!: Table<Dataset, string>
  datasetSamples!: Table<DatasetSample, string>

  constructor() {
    super('ForeignLabelDB')
    this.version(1).stores({
      foreignObjects: 'id, name, category, createdAt',
      backgroundImages: 'id, name, createdAt, datasetId',
      datasets: 'id, name, createdAt',
      datasetSamples: 'id, datasetId, generatedAt',
    })
  }
}

export const db = new AppDatabase()
