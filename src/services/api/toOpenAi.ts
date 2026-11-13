import type {
  AssistantBlockParam,
  FileBlockParam,
  MessageParam,
  TextBlockParam,
} from './types.js'

/**
 * 把应用内部的 Anthropic 风格消息转换成 OpenAI chat/completions 的 messages。
 *
 * 取舍：
 * - OpenAI 协议没有 latest_reminder 角色，快照折进紧随其后的那条 user 消息之前作为 system；
 * - 服务端工具块（server_tool_use / web_search_tool_result / web_fetch_tool_result）与历史思考都不回传，
 *   历史思考的正文在 DeepSeek 侧也不进上下文，这里保持一致；
 * - 附件在 OpenAI 协议下用内联内容表达：图片走 image_url(data URL)，文本类文件拼成正文，
 *   其余二进制文档无法内联，由调用方提前剔除并提示。
 */

export type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAiContentPart[] }
  | { role: 'assistant'; content: string }

/** 已经解析好的附件内容：图片为 data URL，文本为原文 */
export type InlineAttachment =
  | { kind: 'image'; name: string; dataUrl: string }
  | { kind: 'text'; name: string; text: string }

/** 无法内联的附件（PDF、Word 等二进制文档） */
export type SkippedAttachment = { name: string }

/** 单条文本附件内联进正文的最大字符数，避免超出上下文 */
const MAX_TEXT_CHARS = 200_000

/** 文本附件按文件包裹，标明来源，便于模型区分 */
export const formatInlineAttachment = ({ name, text }: { name: string; text: string }) => {
  const body = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…（已截断）` : text
  return `<file name="${name}">\n${body}\n</file>`
}

/** 把一条 user 消息的文本与内联附件合并成 OpenAI 的 content */
const toUserContent = (
  text: string,
  attachments: InlineAttachment[]
): string | OpenAiContentPart[] => {
  const images = attachments.filter(
    (item): item is Extract<InlineAttachment, { kind: 'image' }> => item.kind === 'image'
  )
  const texts = attachments.filter(
    (item): item is Extract<InlineAttachment, { kind: 'text' }> => item.kind === 'text'
  )
  const body = [text, ...texts.map(formatInlineAttachment)].filter(Boolean).join('\n\n')
  if (images.length === 0) {
    return body
  }
  const parts: OpenAiContentPart[] = images.map((image) => ({
    type: 'image_url',
    image_url: { url: image.dataUrl },
  }))
  if (body) {
    parts.unshift({ type: 'text', text: body })
  }
  return parts
}

/** Anthropic 的 assistant 内容块拼成纯文本；工具与思考块不进入历史 */
const assistantText = (blocks: AssistantBlockParam[]): string => {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') {
      text += (text ? '\n\n' : '') + block.text
    }
  }
  return text
}

/** 回复正文拼成续写前缀：只取文本块 */
export const replyPrefixText = (blocks: { type: string; text?: string }[]): string => {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += (text ? '\n\n' : '') + block.text
    }
  }
  return text
}

/** 从消息参数里取第一段文本，附件内联由调用方按消息 id 提供 */
const textOf = (content: string | (FileBlockParam | TextBlockParam)[]) =>
  typeof content === 'string'
    ? content
    : content
        .filter((block): block is TextBlockParam => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n')

/** 预检检索的摘编以 system 消息注入，标明来源是网页检索结果 */
const searchContext = (digest?: string) =>
  digest?.trim()
    ? `以下是与本次提问相关的网页检索结果摘编，请结合它作答，并在引用时标注来源 URL：\n\n${digest.trim()}`
    : ''

/**
 * 生成 OpenAI messages。
 * attachments 按「第几条 user 消息」索引，与 messages 里的 user 顺序一一对应；
 * searchDigest 为预检检索的摘编，作为 system 消息排在历史之前。
 * prefixText 为续写前缀。
 */
export const toOpenAiMessages = (
  system: string,
  messages: MessageParam[],
  attachments: InlineAttachment[][],
  options: { prefixText?: string; searchDigest?: string } = {}
): OpenAiMessage[] => {
  const digest = searchContext(options.searchDigest)
  const result: OpenAiMessage[] = [
    { role: 'system', content: system },
    ...(digest ? [{ role: 'system' as const, content: digest }] : []),
  ]
  let userIndex = 0
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      // 快照作为紧随其后的上下文说明，不占用对话轮次
      if (message.content) {
        result.push({ role: 'system', content: message.content })
      }
      continue
    }
    if (message.role === 'assistant') {
      const text = assistantText(message.content)
      if (text) {
        result.push({ role: 'assistant', content: text })
      }
      continue
    }
    const inline = attachments[userIndex] ?? []
    userIndex += 1
    const content = toUserContent(textOf(message.content), inline)
    if (typeof content === 'string' && !content.trim()) {
      continue
    }
    result.push({ role: 'user', content })
  }
  // 续写：把已有的回复正文作为最后一条 assistant，让模型接着写
  if (options.prefixText?.trim()) {
    result.push({ role: 'assistant', content: options.prefixText })
  }
  return result
}
