import { useDatasetStore } from '@/stores/datasetStore'
import type { BlendMode, BBoxStrategy } from '@/types'

export default function ParamPanel() {
  const { params, updateParams } = useDatasetStore()

  const totalOptions = [10, 100, 500, 1000]
  const hasCustom = !totalOptions.includes(params.totalCount)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="panel-title">生成参数</h2>
      </div>

      <div className="p-4 space-y-5">
        <section>
          <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            📐 生成设置
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                异物数量范围
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={params.objectCountMin}
                  onChange={(e) => updateParams({ objectCountMin: Number(e.target.value) })}
                  className="input-field text-xs w-16 text-center"
                />
                <span className="text-gray-400 text-xs">~</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={params.objectCountMax}
                  onChange={(e) => updateParams({ objectCountMax: Number(e.target.value) })}
                  className="input-field text-xs w-16 text-center"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                缩放范围: {params.scaleMin}%~{params.scaleMax}%
              </label>
              <div className="flex gap-2">
                <input
                  type="range" min={10} max={300} value={params.scaleMin}
                  onChange={(e) => updateParams({ scaleMin: Number(e.target.value) })}
                  className="flex-1"
                />
                <input
                  type="range" min={10} max={300} value={params.scaleMax}
                  onChange={(e) => updateParams({ scaleMax: Number(e.target.value) })}
                  className="flex-1"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                旋转角度: {params.rotationMin}°~{params.rotationMax}°
              </label>
              <div className="flex gap-2">
                <input
                  type="range" min={0} max={360} value={params.rotationMin}
                  onChange={(e) => updateParams({ rotationMin: Number(e.target.value) })}
                  className="flex-1"
                />
                <input
                  type="range" min={0} max={360} value={params.rotationMax}
                  onChange={(e) => updateParams({ rotationMax: Number(e.target.value) })}
                  className="flex-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.opacityVariance}
                  onChange={(e) => updateParams({ opacityVariance: e.target.checked })}
                  className="rounded"
                />
                随机透明度
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.blurVariance}
                  onChange={(e) => updateParams({ blurVariance: e.target.checked })}
                  className="rounded"
                />
                随机模糊
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.brightnessVariance}
                  onChange={(e) => updateParams({ brightnessVariance: e.target.checked })}
                  className="rounded"
                />
                随机亮度
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.contrastVariance}
                  onChange={(e) => updateParams({ contrastVariance: e.target.checked })}
                  className="rounded"
                />
                随机对比度
              </label>
            </div>

            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                边缘融合强度: {params.edgeBlendStrength}
              </label>
              <input
                type="range" min={0} max={100} value={params.edgeBlendStrength}
                onChange={(e) => updateParams({ edgeBlendStrength: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                融合模式
              </label>
              <div className="flex gap-1">
                {([
                  { key: 'feather' as BlendMode, label: '羽化融合' },
                  { key: 'poisson' as BlendMode, label: '泊松融合' },
                  { key: 'direct' as BlendMode, label: '直接融合' },
                ]).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => updateParams({ blendMode: m.key })}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-all ${
                      params.blendMode === m.key
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                边缘留白: {params.edgeMargin}px
              </label>
              <input
                type="range" min={0} max={200} value={params.edgeMargin}
                onChange={(e) => updateParams({ edgeMargin: Number(e.target.value) })}
                className="w-full"
              />
              <div className="text-xs text-gray-400 mt-0.5">
                异物与包装袋边缘的最小距离
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            🏷 标注设置
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">目标框策略</label>
              <div className="flex gap-1">
                {([
                  { key: 'tight' as BBoxStrategy, label: '紧贴目标' },
                  { key: 'expand' as BBoxStrategy, label: '自动扩张' },
                ]).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => updateParams({ bboxStrategy: s.key })}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-all ${
                      params.bboxStrategy === s.key
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {params.bboxStrategy === 'expand' && (
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  扩张比例: {params.bboxExpandRatio}%
                </label>
                <input
                  type="range" min={5} max={30} value={params.bboxExpandRatio}
                  onChange={(e) => updateParams({ bboxExpandRatio: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            📤 输出设置
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">生成数量</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {totalOptions.map((n) => (
                  <button
                    key={n}
                    onClick={() => updateParams({ totalCount: n })}
                    className={`px-3 py-1 rounded text-xs transition-all ${
                      params.totalCount === n && !hasCustom
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="自定义数量"
                  value={hasCustom ? params.totalCount : ''}
                  min={1}
                  max={10000}
                  onChange={(e) => updateParams({ totalCount: Number(e.target.value) || 10 })}
                  className="input-field text-xs w-28"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">命名规则</label>
              <input
                type="text"
                value={params.namingRule}
                onChange={(e) => updateParams({ namingRule: e.target.value })}
                className="input-field text-xs"
                placeholder="image_{index}"
              />
            </div>
          </div>
        </section>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800 mt-auto">
        <button
          onClick={() => updateParams({})}
          className="btn-secondary text-xs w-full"
        >
          重置参数
        </button>
      </div>
    </div>
  )
}
