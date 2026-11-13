import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { isProviderId, PROVIDERS, PROVIDER_IDS, type ProviderId } from './api/providers.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 各服务商的 API Key；没有配置时为 null */
export type ProviderApiKeys = Record<ProviderId, string | null>

/** 各服务商选中的模型；没有选择过时为 null，按服务商默认模型发请求 */
export type ProviderModels = Record<ProviderId, string | null>

/** 本机设置，存 localStorage：服务商与各自的 Key、模型、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  /** 当前用于对话的服务商 */
  provider: ProviderId
  /** 各服务商的 Key；DeepSeek 的 Key 同时用于附件、语音和联网检索 */
  apiKeys: ProviderApiKeys
  /** 各服务商当前选中的模型 */
  models: ProviderModels
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  /** 旧版本只存一个 DeepSeek Key，读取时迁移到 apiKeys.deepseek */
  legacyApiKey: 'chat-demo:api-key',
  provider: 'chat-demo:provider',
  apiKeys: 'chat-demo:api-keys',
  models: 'chat-demo:models',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const emptyApiKeys = (): ProviderApiKeys =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, null])) as ProviderApiKeys

const emptyModels = (): ProviderModels =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, null])) as ProviderModels

/** 读 JSON 对象；解析失败按空对象处理，不抛出 */
const readRecord = (key: string): Record<string, unknown> => {
  const raw = read(key)
  if (!raw) {
    return {}
  }
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** 合并已保存的 Key；旧版本的单个 Key 迁移到 deepseek，迁移后删除旧条目 */
const initialApiKeys = (): ProviderApiKeys => {
  const apiKeys = emptyApiKeys()
  for (const [id, value] of Object.entries(readRecord(KEYS.apiKeys))) {
    if (isProviderId(id) && typeof value === 'string' && value) {
      apiKeys[id] = value
    }
  }
  if (!apiKeys.deepseek) {
    const legacy = read(KEYS.legacyApiKey)
    if (legacy) {
      apiKeys.deepseek = legacy
      write(KEYS.apiKeys, JSON.stringify(apiKeys))
      write(KEYS.legacyApiKey, null)
    }
  }
  return apiKeys
}

const initialModels = (): ProviderModels => {
  const models = emptyModels()
  for (const [id, value] of Object.entries(readRecord(KEYS.models))) {
    if (isProviderId(id) && typeof value === 'string' && value) {
      models[id] = value
    }
  }
  return models
}

/** 未保存过时使用 DeepSeek */
const initialProvider = (): ProviderId => {
  const saved = read(KEYS.provider)
  return isProviderId(saved) ? saved : 'deepseek'
}

export const useSettings = create<Settings>(() => ({
  provider: initialProvider(),
  apiKeys: initialApiKeys(),
  models: initialModels(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

/** 当前服务商的 Key；没有配置时为空串，调用方按空串处理 */
export const getCurrentApiKey = (): string => {
  const { provider, apiKeys } = useSettings.getState()
  return apiKeys[provider] ?? ''
}

/** DeepSeek 的 Key：附件、语音、联网检索都只认这一份 */
export const getDeepseekApiKey = (): string => useSettings.getState().apiKeys.deepseek ?? ''

/** 当前服务商实际使用的模型：用户选择过就用选择，否则用默认模型 */
export const getCurrentModel = (): string => {
  const { provider, models } = useSettings.getState()
  return models[provider] || PROVIDERS[provider].defaultModel
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

/** 切换对话服务商；各家的 Key 与模型互相独立，切回时沿用上次的选择 */
export const setProvider = (provider: ProviderId) => {
  write(KEYS.provider, provider)
  useSettings.setState({ provider })
}

export const setProviderApiKey = (provider: ProviderId, apiKey: string | null) => {
  const apiKeys = { ...useSettings.getState().apiKeys, [provider]: apiKey }
  write(KEYS.apiKeys, JSON.stringify(apiKeys))
  useSettings.setState({ apiKeys })
}

export const setProviderModel = (provider: ProviderId, model: string | null) => {
  const models = { ...useSettings.getState().models, [provider]: model }
  write(KEYS.models, JSON.stringify(models))
  useSettings.setState({ models })
}

/** 兼容旧调用：写入当前服务商的 Key */
export const setApiKey = (apiKey: string | null) =>
  setProviderApiKey(useSettings.getState().provider, apiKey)

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
