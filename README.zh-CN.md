# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 服务商

对话可以走 DeepSeek，也可以走任何 OpenAI 兼容服务。在「设置 → 数据管理」里选择服务商并填写各自的 API Key：

| 服务商       | 协议               | 对话接口                                       | 模型清单                                |
| ------------ | ------------------ | ---------------------------------------------- | --------------------------------------- |
| DeepSeek     | Anthropic Messages | `__API_ORIGIN__/anthropic/v1`                  | `__API_ORIGIN__/models`                 |
| OpenCode Go  | chat/completions   | `https://opencode.ai/inference/go/openai/v1`   | `https://opencode.ai/zen/go/v1/models`  |
| OpenCode Zen | chat/completions   | `https://opencode.ai/inference/openai/v1`      | `https://opencode.ai/zen/v1/models`     |
| OpenDesign   | chat/completions   | `https://amr-link.open-design.ai/v1`           | 同上再加 `/models`                      |

注意 OpenCode 的模型清单与对话接口不在同一路径：`/zen/*/v1/models` 里每条模型都写明了真实的对话 base URL；OpenCode Go 还要求每个会话带稳定的 `x-opencode-session` 请求头，缺失会被 400 拒绝。

### 跨域访问

DeepSeek 的 CORS 响应完整，静态页面可以直连。OpenCode 与 OpenDesign 在鉴权失败时不返回 CORS 头，浏览器里会把「Key 校验失败」显示成网络错误。因此 `pnpm dev` 会把这两家的请求走同源代理（`/provider/*`）；生产构建不含代理，部署为静态站点时需要自建反向代理。确实被 CORS 拦下时，应用会明确提示跨域问题，而不再报成网络异常。

OpenAI 兼容的流式响应会被翻译成与 Anthropic 相同的一套内部事件，思考、正文增量、结束原因和用量都按原有方式渲染。Key 校验通过后会从各家 `GET /models` 拉取模型清单供选择。

只有 DeepSeek 才有的能力统一走 **DeepSeek Key**，所以即使对话由别的服务商处理，也需要单独配置它：

- **附件**：上传走 DeepSeek 的 Files API。对话由 OpenAI 兼容服务商处理时，发送前改为把本地原件内联进请求——图片转成 `image_url` 的 data URL，文本类文件包成 `<file>` 块；PDF、Word 等二进制文档无法内联，会从请求中省略并提示。
- **联网搜索**：DeepSeek 使用服务端搜索工具；OpenAI 兼容服务商则先用 DeepSeek 预检检索一次，把摘编作为 system 消息注入。没有 DeepSeek Key 时搜索开关禁用。
- **语音**：ASR 与 TTS 始终使用 DeepSeek 的接口，因此语音输入与朗读同样需要 DeepSeek Key。

没有 DeepSeek Key 时，OpenAI 兼容服务商仍然支持纯对话、深度思考、历史与重新生成，只是上述能力不可用。

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
