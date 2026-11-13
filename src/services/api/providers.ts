/**
 * 服务商注册表：决定对话走哪套协议、请求发到哪里，以及哪些能力需要额外的 DeepSeek Key。
 *
 * - deepseek：Anthropic 兼容 Messages / Files API，搜索、附件、语音都是原生能力。
 * - opencode-go / opencode-zen / opendesign：OpenAI 兼容 chat/completions + Bearer。
 *   附件与语音仍走 DeepSeek 的 Files / ASR / TTS 接口，因此需要用户另外配置 DeepSeek Key。
 *
 * 关于地址（2026-11 实测）：
 * - OpenCode 的模型清单在 /zen/{go/}v1/models，但对话接口在 /inference/{go/openai/}v1。
 *   清单里每条模型都带 api["chat-completions"].base_url，这里按它取值；
 *   用 /zen/v1/chat/completions 会得到 400/404。
 * - OpenCode Go 还要求每个会话带稳定的 x-opencode-session，并建议使用可识别的
 *   User-Agent；缺少 session 会被 400 拒绝，见 https://opencode.ai/v2/docs/console/go/。
 * - OpenDesign 的鉴权失败响应不带 CORS 头，浏览器直连时会被读成网络错误，
 *   因此开发模式统一走开发服务器代理（见 rspack.config.ts）；生产静态站点需要自建反向代理。
 */

/** 界面上可选的服务商 */
export type ProviderId = 'deepseek' | 'opencode-go' | 'opencode-zen' | 'opendesign'

/** 对话协议：anthropic 为 Messages API，openai 为 chat/completions */
export type WireProtocol = 'anthropic' | 'openai'

export type Provider = {
  id: ProviderId
  /** 设置里展示的名称，不翻译 */
  name: string
  protocol: WireProtocol
  /** 对话接口的根路径，不含结尾斜杠 */
  baseURL: string
  /** 校验 Key 与拉取模型清单的地址 */
  modelsURL: string
  /** 默认模型，用户没有选择时使用 */
  defaultModel: string
  /** 对话请求需要额外携带的固定请求头 */
  headers?: Record<string, string>
}

/** DeepSeek 的固定地址前缀：附件、语音与联网检索都只走这里 */
export const DEEPSEEK_ORIGIN = __API_ORIGIN__
export const DEEPSEEK_ANTHROPIC_BASE_URL = `${DEEPSEEK_ORIGIN}/anthropic/v1`
/** 语音接口 */
export const DEEPSEEK_TOOLS_BASE_URL = `${DEEPSEEK_ORIGIN}/v1/tools`

/**
 * 开发模式下各服务商的同源前缀，由开发服务器代理到真实地址。
 * 生产构建没有开发服务器时为空串，调用方回退到真实地址。
 */
const DEV_PROXY_PREFIX = __DEV_PROXY_PREFIX__

/**
 * 真实地址 → 实际使用的地址。
 * 开发模式把「协议 + 主机」替换成同源前缀，路径原样保留：
 * https://opencode.ai/inference/go/openai/v1 → /provider/opencode-go/inference/go/openai/v1
 * 这样同一服务商的对话与模型清单可以共用一个代理规则（见 rspack.config.ts）。
 */
const route = (url: string, prefix: string) => {
  if (!DEV_PROXY_PREFIX) {
    return url
  }
  const { pathname } = new URL(url)
  return `${DEV_PROXY_PREFIX}/${prefix}${pathname}`
}

/**
 * 应用的 User-Agent 标识。浏览器禁止脚本设置 User-Agent，
 * 这里用服务端要求的自定义标识头发同样的信息，便于上游识别客户端。
 */
export const CLIENT_ID_HEADERS: Record<string, string> = {
  'x-title': 'chat-demo',
}

/**
 * OpenAI 兼容服务：对话与模型清单可能不同源，分别给出真实地址。
 * modelsBase 是模型清单的根（清单接口就是它本身，不再追加路径）。
 */
const openaiProvider = (
  id: ProviderId,
  name: string,
  chatBase: string,
  modelsURL: string,
  proxyPrefix: string,
  headers?: Record<string, string>
): Provider => ({
  id,
  name,
  protocol: 'openai',
  baseURL: route(chatBase, proxyPrefix),
  modelsURL: route(modelsURL, proxyPrefix),
  defaultModel: 'deepseek-v4.1-flash',
  ...(headers ? { headers } : {}),
})

export const PROVIDERS: Record<ProviderId, Provider> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'anthropic',
    // DeepSeek 的 CORS 响应完整，开发与生产都直连
    baseURL: DEEPSEEK_ANTHROPIC_BASE_URL,
    modelsURL: `${DEEPSEEK_ORIGIN}/models`,
    defaultModel: 'deepseek-flash',
  },
  'opencode-go': openaiProvider(
    'opencode-go',
    'OpenCode Go',
    'https://opencode.ai/inference/go/openai/v1',
    'https://opencode.ai/zen/go/v1/models',
    'opencode-go',
    CLIENT_ID_HEADERS
  ),
  'opencode-zen': openaiProvider(
    'opencode-zen',
    'OpenCode Zen',
    'https://opencode.ai/inference/openai/v1',
    'https://opencode.ai/zen/v1/models',
    'opencode-zen',
    CLIENT_ID_HEADERS
  ),
  opendesign: openaiProvider(
    'opendesign',
    'OpenDesign',
    'https://amr-link.open-design.ai/v1',
    'https://amr-link.open-design.ai/v1/models',
    'opendesign'
  ),
}

/** 设置里的展示顺序 */
export const PROVIDER_IDS: ProviderId[] = ['deepseek', 'opencode-go', 'opencode-zen', 'opendesign']

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && Object.hasOwn(PROVIDERS, value)

export const getProvider = (id: ProviderId): Provider => PROVIDERS[id]

/** 非 DeepSeek 服务商只提供对话，附件与语音要借 DeepSeek 的接口 */
export const usesDeepseekForAttachments = (id: ProviderId) => PROVIDERS[id].protocol === 'openai'
