import { ApiError, request } from './client.js'
import { DEEPSEEK_ANTHROPIC_BASE_URL } from './providers.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'

/**
 * 预检式联网检索。
 *
 * OpenAI 兼容服务商（opencode / opendesign）没有 DeepSeek 的服务端搜索工具，
 * 这里先用 DeepSeek Key 单独发起一次「只带 deepseek_web_search 的」对话，
 * 把模型检索并摘编出的结果作为上下文注入当前服务商的请求。
 * 检索失败不阻断主请求，由调用方决定是否降级为无搜索结果。
 */

const SEARCH_SYSTEM_PROMPT =
  '你是检索助手。请使用联网搜索工具查找与问题相关的公开资料，用简洁的中文（或与问题相同的语言）列出要点：' +
  '每条要点后附上来源 URL。不要编造，找不到相关内容时直接说明未找到。'

/** 一次预检检索的结果 */
export type SearchDigest = {
  /** 可直接注入上下文的摘编文本 */
  text: string
  /** 检索到的来源，用于界面展示 */
  sources: { url: string; title: string }[]
}

/** 摘编超过这个长度就截断，避免挤占主请求的上下文 */
const MAX_DIGEST_CHARS = 6000

/**
 * 用 DeepSeek Key 做一次联网检索并返回摘编；失败时抛出 ApiError，由调用方吞掉并降级。
 */
export const digestWebSearch = async (
  deepseekApiKey: string,
  question: string,
  model: string,
  signal: AbortSignal
): Promise<SearchDigest> => {
  const response = await request(`${DEEPSEEK_ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': deepseekApiKey,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      system: SEARCH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
      thinking: { type: 'disabled' },
      safety_check: { level: 'high' },
      tools: [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }],
      stream: true,
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw new ApiError('protocol', await response.text().catch(() => ''))
  }
  let text = ''
  const sources: { url: string; title: string }[] = []
  const seen = new Set<string>()
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block.type === 'web_search_tool_result') {
        for (const item of block.content) {
          if (item.type === 'web_search_result' && !seen.has(item.url)) {
            seen.add(item.url)
            sources.push({ url: item.url, title: item.title })
          }
        }
      }
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    } else if (event.type === 'message_stop') {
      break
    }
  }
  const trimmed = text.trim().slice(0, MAX_DIGEST_CHARS)
  if (!trimmed && sources.length === 0) {
    throw new ApiError('protocol', '')
  }
  const body =
    trimmed ||
    sources.map((source) => `- ${source.title || source.url}: ${source.url}`).join('\n')
  return { text: body, sources }
}
