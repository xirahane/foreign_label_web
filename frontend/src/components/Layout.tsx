import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/stores/appStore'

const steps = [
  { id: 'library', path: '/library', label: 'Step 1', title: '异物库管理', desc: '提取和管理异物素材' },
  { id: 'config', path: '/config', label: 'Step 2', title: '数据集配置', desc: '创建和配置数据集' },
  { id: 'generator', path: '/generator', label: 'Step 3', title: '数据生成器', desc: '批量合成训练数据' },
  { id: 'management', path: '/management', label: '管理', title: '数据集管理', desc: '浏览和导出数据集' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()

  const currentStepIndex = steps.findIndex((s) => location.pathname.startsWith(s.path))

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1
              className="text-lg font-bold bg-gradient-to-r from-primary-500 to-purple-500 bg-clip-text text-transparent cursor-pointer select-none"
              onClick={() => navigate('/library')}
            >
              AI异物数据集生成平台
            </h1>
            <nav className="hidden md:flex items-center gap-1 ml-6">
              {steps.map((step, idx) => {
                const isActive = idx === currentStepIndex
                const isPast = idx < currentStepIndex
                return (
                  <button
                    key={step.id}
                    onClick={() => navigate(step.path)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
                      isActive
                        ? 'bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400 font-medium'
                        : isPast
                        ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900'
                        : 'text-gray-400 dark:text-gray-600'
                    }`}
                  >
                    <span className={`text-xs font-mono font-bold ${
                      isActive ? 'text-primary-500' : isPast ? 'text-green-500' : 'text-gray-300 dark:text-gray-700'
                    }`}>
                      {isPast ? '✓' : step.label}
                    </span>
                    <span className="hidden lg:inline">{step.title}</span>
                  </button>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-lg"
              title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>

        <div className="flex md:hidden mt-2 gap-1 overflow-x-auto pb-1">
          {steps.map((step, idx) => {
            const isActive = idx === currentStepIndex
            return (
              <button
                key={step.id}
                onClick={() => navigate(step.path)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs transition-all ${
                  isActive
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}
              >
                {step.label}
              </button>
            )
          })}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
