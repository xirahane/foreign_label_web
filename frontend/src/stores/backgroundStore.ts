import { create } from 'zustand'
import { db } from '@/db/db'
import type { BackgroundImage } from '@/types'

interface BackgroundStore {
  backgrounds: BackgroundImage[]
  selectedBgIds: string[]
  loading: boolean
  loadBackgrounds: () => Promise<void>
  addBackground: (data: { name: string; dataUrl: string; width: number; height: number; yoloBoxes?: import('@/types').YOLOBoxRaw[] }) => Promise<void>
  removeBackground: (id: string) => Promise<void>
  removeBackgrounds: (ids: string[]) => Promise<void>
  selectBg: (id: string, multi?: boolean) => void
  selectAllBg: () => void
  clearBgSelection: () => void
}

export const useBackgroundStore = create<BackgroundStore>((set, get) => ({
  backgrounds: [],
  selectedBgIds: [],
  loading: false,

  loadBackgrounds: async () => {
    set({ loading: true })
    const backgrounds = await db.backgroundImages.orderBy('createdAt').reverse().toArray()
    set({ backgrounds, loading: false })
  },

  addBackground: async (data) => {
    const bg: BackgroundImage = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    await db.backgroundImages.put(bg)
    await get().loadBackgrounds()
  },

  removeBackground: async (id) => {
    await db.backgroundImages.delete(id)
    set((s) => ({ selectedBgIds: s.selectedBgIds.filter((bid) => bid !== id) }))
    await get().loadBackgrounds()
  },

  removeBackgrounds: async (ids) => {
    await db.backgroundImages.bulkDelete(ids)
    set({ selectedBgIds: [] })
    await get().loadBackgrounds()
  },

  selectBg: (id, multi = false) => {
    set((s) => {
      if (!multi) return { selectedBgIds: [id] }
      const exists = s.selectedBgIds.includes(id)
      return {
        selectedBgIds: exists
          ? s.selectedBgIds.filter((bid) => bid !== id)
          : [...s.selectedBgIds, id],
      }
    })
  },

  selectAllBg: () => set((s) => ({ selectedBgIds: s.backgrounds.map((b) => b.id) })),
  clearBgSelection: () => set({ selectedBgIds: [] }),
}))
