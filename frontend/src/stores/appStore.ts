import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface AppState {
  theme: Theme
  currentStep: import('@/types').Step
  sidebarOpen: boolean
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  setStep: (step: import('@/types').Step) => void
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  theme: (localStorage.getItem('theme') as Theme) || 'light',
  currentStep: 'library',
  sidebarOpen: true,
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      localStorage.setItem('theme', next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      return { theme: next }
    }),
  setTheme: (theme: Theme) => {
    localStorage.setItem('theme', theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },
  setStep: (step) => set({ currentStep: step }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
