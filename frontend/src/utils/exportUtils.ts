import JSZip from 'jszip'
import type { DatasetSample, ForeignObject } from '@/types'

export async function exportMasksByCategory(
  objects: ForeignObject[]
): Promise<Blob> {
  const zip = new JSZip()

  const byCategory = new Map<string, ForeignObject[]>()
  for (const obj of objects) {
    if (!obj.maskData) continue
    const cat = obj.category || '默认'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(obj)
  }

  for (const [cat, items] of byCategory) {
    const catFolder = zip.folder(cat)!
    for (let i = 0; i < items.length; i++) {
      const obj = items[i]
      const img = await new Promise<HTMLImageElement>((resolve) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.src = obj.cutoutImage
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png')
      )
      const idx = String(i + 1).padStart(4, '0')
      catFolder.file(`${obj.name}_${idx}.png`, blob)
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export function generateYOLOLabel(
  annotation: DatasetSample['annotations'][0],
  imgWidth: number,
  imgHeight: number
): string {
  const cx = annotation.centerX / imgWidth
  const cy = annotation.centerY / imgHeight
  const w = annotation.width / imgWidth
  const h = annotation.height / imgHeight
  return `${annotation.classId} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
}

export function generateYOLOLabelsForSample(
  annotations: DatasetSample['annotations'],
  imgWidth: number,
  imgHeight: number
): string {
  return annotations.map((a) => generateYOLOLabel(a, imgWidth, imgHeight)).join('\n')
}

export async function exportDataset(
  samples: DatasetSample[],
  classes: string[],
  datasetName: string
): Promise<Blob> {
  const zip = new JSZip()
  const datasetFolder = zip.folder(datasetName)!

  const imagesFolder = datasetFolder.folder('images')!
  const labelsFolder = datasetFolder.folder('labels')!

  const loadImg = (src: string) =>
    new Promise<HTMLImageElement>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.src = src
    })

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const idx = String(i + 1).padStart(4, '0')
    const img = await loadImg(sample.imageData)
    const imgArea = img.width * img.height
    const minArea = imgArea * 0.001

    const expandedAnnotations = sample.annotations.map((ann) => {
      const area = ann.width * ann.height
      if (area < minArea && area > 0) {
        const scaleFactor = Math.sqrt(minArea / area)
        return { ...ann, width: ann.width * scaleFactor, height: ann.height * scaleFactor }
      }
      return ann
    })

    const imgCanvas = document.createElement('canvas')
    imgCanvas.width = img.width
    imgCanvas.height = img.height
    const ctx = imgCanvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, img.width, img.height)
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob>((resolve) =>
      imgCanvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95)
    )
    imagesFolder.file(`${idx}.jpg`, blob)

    const labelStr = generateYOLOLabelsForSample(expandedAnnotations, img.width, img.height)
    labelsFolder.file(`${idx}.txt`, labelStr)
  }

  const classesStr = '0'
  datasetFolder.file('classes.txt', classesStr)

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
