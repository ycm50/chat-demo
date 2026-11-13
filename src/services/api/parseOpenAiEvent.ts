import type { MessageStreamEvent, StopReason } from './types.js'

/**
 * 把 OpenAI 兼容 chat/completions 的流式增量翻译成应用内部使用的 Anthropic 事件序列。
 *
 * 翻译规则：
 * - 首次收到 delta 时发 message_start；
 * - reasoning_content / reasoning 增量映射为 thinking 块，content 增量映射为 text 块，各自在切换时关闭上一个块；
 * - finish_reason 映射为 StopReason（stop→end_turn、length→max_tokens、content_filter→refusal）；
 * - [DONE] 或流结束发 message_delta + message_stop，让上层的归并逻辑与 Anthropic 完全一致。
 */

/** 一次请求内的翻译状态：记录当前打开的内容块与是否已经结束 */
export type OpenAiStreamState = {
  model: string
  /** 已发出 message_start */
  started: boolean
  /** 当前打开的内容块类型与下标 */
  openBlock: { type: 'thinking' | 'text'; index: number } | null
  /** 下一个可用的内容块下标 */
  nextIndex: number
  /** 已收到的结束原因；为 null 表示还没有 finish_reason */
  stopReason: StopReason | null
  /** 已发出 message_stop */
  finished: boolean
  /** 累计用量，OpenAI 在末尾或每个 chunk 的 usage 字段中给出 */
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
}

export const createOpenAiStreamState = (model: string): OpenAiStreamState => ({
  model,
  started: false,
  openBlock: null,
  nextIndex: 0,
  stopReason: null,
  finished: false,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

/** finish_reason → StopReason；未知原因按正常结束处理 */
const toStopReason = (value: unknown): StopReason | null => {
  switch (value) {
    case 'stop':
    case 'end_turn':
      return 'end_turn'
    case 'length':
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
    case 'tool_use':
      return 'tool_use'
    case 'content_filter':
    case 'refusal':
      return 'refusal'
    default:
      return null
  }
}

/** 累计 usage；OpenAI 各家的字段命名不完全一致，能读到的都算上 */
const readUsage = (state: OpenAiStreamState, value: unknown) => {
  if (!isRecord(value)) {
    return
  }
  const pick = (key: string) =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) ? (value[key] as number) : 0
  state.usage.input_tokens += pick('prompt_tokens') || pick('input_tokens')
  state.usage.output_tokens += pick('completion_tokens') || pick('output_tokens')
  const cached = pick('cached_tokens')
  if (cached) {
    state.usage.cache_read_input_tokens += cached
  }
}

const start = (state: OpenAiStreamState): MessageStreamEvent => {
  state.started = true
  return {
    type: 'message_start',
    message: { id: `openai-${Date.now().toString(36)}`, model: state.model },
  }
}

const closeBlock = (state: OpenAiStreamState): MessageStreamEvent[] => {
  if (!state.openBlock) {
    return []
  }
  const event: MessageStreamEvent = { type: 'content_block_stop', index: state.openBlock.index }
  state.openBlock = null
  return [event]
}

/** 需要写内容时先确保对应类型的块已打开；切换类型会关闭上一个块 */
const ensureBlock = (
  state: OpenAiStreamState,
  type: 'thinking' | 'text'
): { events: MessageStreamEvent[]; index: number } => {
  if (state.openBlock?.type === type) {
    return { events: [], index: state.openBlock.index }
  }
  const events = closeBlock(state)
  const index = state.nextIndex
  state.nextIndex += 1
  state.openBlock = { type, index }
  events.push({
    type: 'content_block_start',
    index,
    content_block: type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' },
  })
  return { events, index }
}

/**
 * 消费一个 SSE data 帧，产出翻译后的事件；state 会被就地更新。
 * 兼容 delta.reasoning_content（DeepSeek / vLLM）、delta.reasoning（部分网关）
 * 以及非流式的 message.content 形状。
 */
export function* readOpenAiEvent(
  payload: unknown,
  state: OpenAiStreamState
): Generator<MessageStreamEvent> {
  const events: MessageStreamEvent[] = []
  if (!isRecord(payload)) {
    return
  }
  if (!state.started) {
    events.push(start(state))
  }
  readUsage(state, payload.usage)
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const choice = isRecord(choices[0]) ? choices[0] : null
  if (!choice) {
    for (const event of events) {
      yield event
    }
    return
  }
  const delta = isRecord(choice.delta)
    ? choice.delta
    : isRecord(choice.message)
      ? choice.message
      : null
  if (delta) {
    const reasoning =
      (isString(delta.reasoning_content) && delta.reasoning_content) ||
      (isString(delta.reasoning) && delta.reasoning) ||
      ''
    if (reasoning) {
      const block = ensureBlock(state, 'thinking')
      events.push(...block.events, {
        type: 'content_block_delta',
        index: block.index,
        delta: { type: 'thinking_delta', thinking: reasoning },
      })
    }
    const text = isString(delta.content) ? delta.content : ''
    if (text) {
      const block = ensureBlock(state, 'text')
      events.push(...block.events, {
        type: 'content_block_delta',
        index: block.index,
        delta: { type: 'text_delta', text },
      })
    }
  }
  const stopReason = toStopReason(choice.finish_reason)
  if (stopReason) {
    state.stopReason = stopReason
  }
  for (const event of events) {
    yield event
  }
}

/** 收尾：关闭未结束的块，发 message_delta 与 message_stop */
export function* finishOpenAiStream(
  state: OpenAiStreamState,
  normal: boolean
): Generator<MessageStreamEvent> {
  if (state.finished) {
    return
  }
  if (!state.started) {
    yield start(state)
  }
  const stopReason: StopReason = state.stopReason ?? (normal ? 'end_turn' : 'end_turn')
  for (const event of closeBlock(state)) {
    yield event
  }
  state.finished = true
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { ...state.usage },
  }
  yield { type: 'message_stop' }
}
