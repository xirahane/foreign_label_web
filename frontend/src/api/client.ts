const BASE = '/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  return res.json()
}

export interface ObjectInfo {
  id: string
  name: string
  category: string
  thumbnail_url: string
  original_url: string
  cutout_url: string
  created_at: number
  usage_count: number
}

export interface BackgroundInfo {
  id: string
  name: string
  image_url: string
  width: number
  height: number
  created_at: number
}

export interface DatasetInfo {
  id: string
  name: string
  category_count: number
  output_format: string
  image_width: number
  image_height: number
  created_at: number
  generated_count: number
}

export interface SampleInfo {
  id: string
  dataset_id: string
  image_url: string
  label_url: string
  generated_at: number
}

export interface GenerateParams {
  dataset_id: string
  background_id: string
  object_ids: string[]
  object_count_min: number
  object_count_max: number
  scale_min: number
  scale_max: number
  rotation_min: number
  rotation_max: number
  opacity_variance: boolean
  edge_blend: number
  blend_mode: string
  bbox_strategy: string
  bbox_expand: number
  edge_margin: number
  total_count: number
}

// Objects API
export async function uploadObject(file: File, name: string, category: string, threshold: number, invert: boolean) {
  const form = new FormData()
  form.append('file', file)
  form.append('name', name)
  form.append('category', category)
  form.append('threshold', String(threshold))
  form.append('invert', String(invert))
  const res = await fetch(`${BASE}/objects/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ object: ObjectInfo; detection: any }>
}

export async function listObjects() {
  return request<{ objects: ObjectInfo[] }>('/objects')
}

export async function updateObject(id: string, name: string, category: string) {
  const form = new FormData()
  form.append('name', name)
  form.append('category', category)
  return request('/objects/' + id, { method: 'PUT', body: form })
}

export async function deleteObject(id: string) {
  return request('/objects/' + id, { method: 'DELETE' })
}

export async function detectObject(id: string, threshold: number, invert: boolean) {
  return request<any>('/objects/' + id + '/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold, invert }),
  })
}

export async function extractObject(id: string, maskBase64: string) {
  return request<any>('/objects/' + id + '/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, mask_base64: maskBase64 }),
  })
}

// Backgrounds API
export async function uploadBackground(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/backgrounds/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ background: BackgroundInfo }>
}

export async function listBackgrounds() {
  return request<{ backgrounds: BackgroundInfo[] }>('/backgrounds')
}

export async function deleteBackground(id: string) {
  return request('/backgrounds/' + id, { method: 'DELETE' })
}

// Datasets API
export async function createDataset(name: string, format: string, w: number, h: number) {
  return request<any>('/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, output_format: format, image_width: w, image_height: h }),
  })
}

export async function listDatasets() {
  return request<{ datasets: DatasetInfo[] }>('/datasets')
}

export async function deleteDataset(id: string) {
  return request('/datasets/' + id, { method: 'DELETE' })
}

export async function listSamples(datasetId: string) {
  return request<{ samples: SampleInfo[] }>('/datasets/' + datasetId + '/samples')
}

export async function deleteSample(datasetId: string, sampleId: string) {
  return request('/datasets/' + datasetId + '/samples/' + sampleId, { method: 'DELETE' })
}

// Generate API
export async function generatePreview(params: GenerateParams) {
  return request<{ image_base64: string; labels: string[] }>('/generate/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export async function generateBatch(params: GenerateParams) {
  return request<{ generated: number; ok: boolean }>('/generate/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export function getExportUrl(datasetId: string) {
  return `${BASE}/datasets/${datasetId}/export`
}
