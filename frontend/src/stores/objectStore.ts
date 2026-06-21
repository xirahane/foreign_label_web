import { create } from 'zustand'
import { db } from '@/db/db'
import type { ForeignObject } from '@/types'

interface ObjectStore {
  objects: ForeignObject[]
  selectedIds: string[]
  searchQuery: string
  categoryFilter: string
  loading: boolean
  loadObjects: () => Promise<void>
  addObject: (obj: Omit<ForeignObject, 'id' | 'createdAt' | 'usageCount'>) => Promise<void>
  updateObject: (id: string, updates: Partial<ForeignObject>) => Promise<void>
  removeObject: (id: string) => Promise<void>
  removeObjects: (ids: string[]) => Promise<void>
  selectObject: (id: string, multi?: boolean) => void
  selectAll: () => void
  clearSelection: () => void
  setSearchQuery: (q: string) => void
  setCategoryFilter: (c: string) => void
  incrementUsage: (id: string) => Promise<void>
}

export const useObjectStore = create<ObjectStore>((set, get) => ({
  objects: [],
  selectedIds: [],
  searchQuery: '',
  categoryFilter: '',
  loading: false,

  loadObjects: async () => {
    set({ loading: true })
    const objects = await db.foreignObjects.orderBy('createdAt').reverse().toArray()
    set({ objects, loading: false })
  },

  addObject: async (obj) => {
    const newObj: ForeignObject = {
      ...obj,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      usageCount: 0,
    }
    await db.foreignObjects.put(newObj)
    await get().loadObjects()
  },

  updateObject: async (id, updates) => {
    await db.foreignObjects.update(id, updates)
    await get().loadObjects()
  },

  removeObject: async (id) => {
    await db.foreignObjects.delete(id)
    set((s) => ({ selectedIds: s.selectedIds.filter((sid) => sid !== id) }))
    await get().loadObjects()
  },

  removeObjects: async (ids) => {
    await db.foreignObjects.bulkDelete(ids)
    set({ selectedIds: [] })
    await get().loadObjects()
  },

  selectObject: (id, multi = false) => {
    set((s) => {
      if (!multi) return { selectedIds: [id] }
      const exists = s.selectedIds.includes(id)
      return {
        selectedIds: exists
          ? s.selectedIds.filter((sid) => sid !== id)
          : [...s.selectedIds, id],
      }
    })
  },

  selectAll: () => set((s) => ({ selectedIds: s.objects.map((o) => o.id) })),
  clearSelection: () => set({ selectedIds: [] }),

  setSearchQuery: (q) => set({ searchQuery: q }),
  setCategoryFilter: (c) => set({ categoryFilter: c }),

  incrementUsage: async (id) => {
    const obj = await db.foreignObjects.get(id)
    if (obj) {
      await db.foreignObjects.update(id, { usageCount: (obj.usageCount || 0) + 1 })
      await get().loadObjects()
    }
  },
}))
