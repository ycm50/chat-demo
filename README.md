# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## Providers

Chat can run against DeepSeek or any OpenAI-compatible provider. Pick the provider in Settings → Data, and enter its API key there. Available providers:

| Provider      | Protocol           | Chat endpoint                                  | Model list                              |
| ------------- | ------------------ | ---------------------------------------------- | --------------------------------------- |
| DeepSeek      | Anthropic Messages | `__API_ORIGIN__/anthropic/v1`                  | `__API_ORIGIN__/models`                 |
| OpenCode Go   | chat/completions   | `https://opencode.ai/inference/go/openai/v1`   | `https://opencode.ai/zen/go/v1/models`  |
| OpenCode Zen  | chat/completions   | `https://opencode.ai/inference/openai/v1`      | `https://opencode.ai/zen/v1/models`     |
| OpenDesign    | chat/completions   | `https://amr-link.open-design.ai/v1`           | the same base + `/models`               |

Note that OpenCode's model list and chat endpoints live under different paths — the catalog in `/zen/*/v1/models` reports the real chat base URL per model, and OpenCode Go additionally requires a stable `x-opencode-session` header per conversation.

### Cross-origin access

DeepSeek sends complete CORS headers, so it works from a static page. OpenCode and OpenDesign do not return CORS headers on their auth-error responses, which makes any failed key check look like a network error in the browser. `pnpm dev` therefore proxies those providers through same-origin paths (`/provider/*`); the production build contains no proxy and needs a reverse proxy of your own in front of it for those providers. When a request is blocked by CORS, the app now says so explicitly instead of reporting a network failure.

OpenAI-compatible streams are translated into the same internal event stream as the Anthropic one, so thinking, streaming text, stop reasons, and usage all render identically. Model lists are fetched from each provider's `GET /models` after the key is verified.

Capabilities that only exist on DeepSeek are routed through the **DeepSeek key**, which is why it is requested separately even when another provider handles the chat:

- **Attachments**: uploaded through the DeepSeek Files API. For OpenAI-compatible providers the local originals are inlined into the request instead — images as `image_url` data URLs and text-like files as `<file>` blocks. PDF, Word, and other binary documents cannot be inlined and are left out of the request, with a notice.
- **Web search**: DeepSeek uses its server-side search tool. For OpenAI-compatible providers a preflight DeepSeek request performs the search, and its digest is injected as a system message. Without a DeepSeek key the search toggle is disabled.
- **Speech**: ASR and TTS always use the DeepSeek endpoints, so voice input and read-aloud need the DeepSeek key as well.

Without a DeepSeek key, an OpenAI-compatible provider still supports plain chat, thinking, history, and regeneration; only the capabilities above are unavailable.

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
