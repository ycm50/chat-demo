import type { InlineAttachment, SkippedAttachment } from '../api/toOpenAi.js'
import type { FileAttachment } from './types.js'
import { loadFile } from './db.js'

/**
 * 把附件读成可以内联进 OpenAI 请求的内容：
 * 图片转 data URL，纯文本类文件读成正文，其余（PDF、Word、表格等二进制文档）无法内联。
 * 与 DeepSeek 的 Files API 无关，直接使用本地原件。
 */

/** 允许内联为文本的扩展名；与 uploadExts 的白名单取交集后使用 */
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'ps1',
  'bat',
  'sql',
  'vue',
  'svelte',
  'qml',
  'qss',
  'wxml',
  'wxss',
  'axml',
  'acss',
  'log',
])

/** 单张图片内联后的最大字节数（base64 前），超过则跳过，避免请求体过大 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 无法内联的附件提示：与上传配额提示一样，由界面层转成 toast */
export type InlineNotice = { names: string[] }
const noticeListeners = new Set<(notice: InlineNotice) => void>()

/** 订阅「附件无法随当前服务商发送」的提示，由界面层转成 toast */
export const onInlineNotice = (listener: (notice: InlineNotice) => void) => {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

/** 通知所有订阅者；没有订阅者时静默丢弃 */
export const notifyInlineNotice = (notice: InlineNotice) => {
  for (const listener of noticeListeners) {
    listener(notice)
  }
}

/** 去重后最多列三个文件名，其余用数量概括 */
export const describeSkippedNames = (names: string[]): InlineNotice => {
  const unique = [...new Set(names)]
  return {
    names: unique.slice(0, 3).concat(unique.length > 3 ? [`+${unique.length - 3}`] : []),
  }
}

const toDataUrl = (blob: Blob, mimeType: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    // 有些附件在 IndexedDB 里没有 MIME，按图片类别补一个默认值
    reader.readAsDataURL(new Blob([blob], { type: mimeType || blob.type || 'image/png' }))
  })

/**
 * 解析一组附件。本地没有原件（如导入的历史文档附件）或体积超限的按跳过处理，
 * 由调用方提示「这些附件未进入本次请求」。
 */
export const inlineAttachments = async (
  files: FileAttachment[]
): Promise<{ inline: InlineAttachment[]; skipped: SkippedAttachment[] }> => {
  const inline: InlineAttachment[] = []
  const skipped: SkippedAttachment[] = []
  for (const file of files) {
    const ext = extOf(file.name)
    const isText = !file.isImage && TEXT_EXTS.has(ext)
    if (!file.isImage && !isText) {
      skipped.push({ name: file.name })
      continue
    }
    if (file.isImage && file.size > MAX_IMAGE_BYTES) {
      skipped.push({ name: file.name })
      continue
    }
    const blob = await loadFile(file.id)
    if (!blob) {
      skipped.push({ name: file.name })
      continue
    }
    if (file.isImage) {
      inline.push({
        kind: 'image',
        name: file.name,
        dataUrl: await toDataUrl(blob, file.mimeType || blob.type),
      })
    } else {
      inline.push({ kind: 'text', name: file.name, text: await blob.text() })
    }
  }
  return { inline, skipped }
}
