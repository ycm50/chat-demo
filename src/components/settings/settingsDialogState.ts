import { create } from 'zustand'
import { getCurrentApiKey, getDeepseekApiKey } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有当前服务商的 API Key 时打开设置并选中 Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (getCurrentApiKey()) {
    return true
  }
  openSettings('data')
  return false
}

/**
 * 附件与语音固定使用 DeepSeek 的接口，没有 DeepSeek Key 时打开设置并返回 false。
 * 与对话服务商无关：非 DeepSeek 服务商也可以只配 DeepSeek Key 来上传附件。
 */
export const requireDeepseekKey = () => {
  if (getDeepseekApiKey()) {
    return true
  }
  openSettings('data')
  return false
}
