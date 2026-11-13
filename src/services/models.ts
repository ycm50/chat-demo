import { create } from 'zustand'
import { listModels, type ModelOption } from './api/client.js'
import { getProvider, PROVIDER_IDS, type ProviderId } from './api/providers.js'
import { useSettings } from './settings.js'

/**
 * 各服务商的模型清单缓存。
 * 只缓存在内存里：切换服务商或重新校验 Key 时重新拉取，失败保留上一次的结果。
 */
type ModelState = {
  /** 各服务商拉到的模型；尚未拉取时为空数组 */
  lists: Record<ProviderId, ModelOption[]>
  /** 正在拉取的服务商 */
  loading: Record<ProviderId, boolean>
}

const emptyLists = (): Record<ProviderId, ModelOption[]> =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, [] as ModelOption[]])) as Record<
    ProviderId,
    ModelOption[]
  >

const emptyLoading = (): Record<ProviderId, boolean> =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, false])) as Record<ProviderId, boolean>

export const useModels = create<ModelState>(() => ({
  lists: emptyLists(),
  loading: emptyLoading(),
}))

/** 用已保存的 Key 拉取模型清单；没有 Key 或请求失败时保留原值 */
export const refreshModels = async (providerId: ProviderId): Promise<void> => {
  const apiKey = useSettings.getState().apiKeys[providerId]
  if (!apiKey || useModels.getState().loading[providerId]) {
    return
  }
  useModels.setState((state) => ({ loading: { ...state.loading, [providerId]: true } }))
  try {
    const models = await listModels(getProvider(providerId), apiKey)
    useModels.setState((state) => ({ lists: { ...state.lists, [providerId]: models } }))
  } catch {
    // 拉取失败不影响使用：仍然可以按默认模型请求
  } finally {
    useModels.setState((state) => ({ loading: { ...state.loading, [providerId]: false } }))
  }
}

/** 用尚未保存的 Key 拉一次清单：既校验 Key，也立刻得到模型选项 */
export const loadModelsWithKey = async (
  providerId: ProviderId,
  apiKey: string
): Promise<ModelOption[]> => {
  const models = await listModels(getProvider(providerId), apiKey)
  useModels.setState((state) => ({ lists: { ...state.lists, [providerId]: models } }))
  return models
}
