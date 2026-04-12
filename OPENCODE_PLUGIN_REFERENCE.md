# OpenCode Plugin Reference

Tài liệu tham khảo đầy đủ về events, hooks, và API để xây dựng plugin cho OpenCode.

---

## Mục lục

- [Tổng quan kiến trúc Plugin](#tổng-quan-kiến-trúc-plugin)
- [Server Plugin Hooks](#server-plugin-hooks)
  - [Event & Config](#event--config)
  - [Chat](#chat)
  - [Permission & Command](#permission--command)
  - [Tool](#tool)
  - [Shell](#shell)
  - [Auth & Provider](#auth--provider)
  - [Experimental](#experimental)
- [Toàn bộ Events](#toàn-bộ-events)
  - [Project Events](#project-events)
  - [Installation Events](#installation-events)
  - [Server Events](#server-events)
  - [LSP Events](#lsp-events)
  - [Message Events](#message-events)
  - [Permission Events](#permission-events)
  - [Question Events](#question-events)
  - [Session Events](#session-events)
  - [File Events](#file-events)
  - [Todo Events](#todo-events)
  - [Command Events](#command-events)
  - [MCP Events](#mcp-events)
  - [VCS Events](#vcs-events)
  - [Workspace Events](#workspace-events)
  - [Worktree Events](#worktree-events)
  - [PTY Events](#pty-events)
  - [TUI Events](#tui-events)
- [TUI Plugin API](#tui-plugin-api)
  - [Command API](#command-api)
  - [Route API](#route-api)
  - [UI API](#ui-api)
  - [Keybind API](#keybind-api)
  - [KV Store](#kv-store)
  - [State API](#state-api)
  - [Theme API](#theme-api)
  - [App API](#app-api)
  - [Client API](#client-api)
  - [TUI Config](#tui-config)
  - [Workspace API](#workspace-api)
  - [Event Bus](#event-bus)
  - [Renderer](#renderer)
  - [Slots API](#slots-api)
  - [Plugin Control](#plugin-control)
  - [Lifecycle API](#lifecycle-api)
- [TuiPluginMeta](#tuipluginmeta)
- [Ví dụ Plugin](#ví-dụ-plugin)

---

## Tổng quan kiến trúc Plugin

OpenCode có hai loại plugin:

### Server Plugin (`@opencode-ai/plugin`)

- Chạy trên server runtime
- Export dạng function hoặc `{ id?, server }` module
- Có thể hook vào chat, tool, permission, shell, auth, provider...
- Cấu hình trong `opencode.json`:

```json
{
  "plugin": ["my-plugin@1.0.0", ["./plugins/demo.ts", { "label": "demo" }]]
}
```

### TUI Plugin (`@opencode-ai/plugin/tui`)

- Chạy trên TUI (Terminal UI) runtime
- Export dạng `{ id?, tui }` module
- Có thể đăng ký commands, routes, UI slots, keybinds, themes...
- Cấu hình trong `tui.json`:

```json
{
  "plugin": ["my-tui-plugin@1.0.0"]
}
```

### Nguồn tải plugin

1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin directory (`~/.config/opencode/plugins/`)
4. Project plugin directory (`.opencode/plugins/`)

---

## Server Plugin Hooks

Server plugin là một function nhận `PluginInput` và trả về object `Hooks`:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    // Hooks implementations
  }
}
```

**PluginInput** bao gồm:

| Field       | Type             | Mô tả                          |
| ----------- | ---------------- | ------------------------------ |
| `client`    | `OpencodeClient` | SDK client để tương tác với AI |
| `project`   | `Project`        | Thông tin project hiện tại     |
| `directory` | `string`         | Working directory              |
| `worktree`  | `string`         | Git worktree path              |
| `serverUrl` | `URL`            | URL của server                 |
| `$`         | `BunShell`       | Bun shell API                  |

---

### Event & Config

#### `event`

Nhận mọi event từ hệ thống. Đây là cách quan sát (observe) toàn bộ hoạt động.

```ts
event?: (input: { event: Event }) => Promise<void>
```

Ví dụ:

```ts
"event": async ({ event }) => {
  if (event.type === "session.idle") {
    console.log("Session completed!")
  }
}
```

#### `config`

Được gọi khi config thay đổi.

```ts
config?: (input: Config) => Promise<void>
```

---

### Chat

#### `chat.message`

Được gọi khi nhận message mới.

```ts
"chat.message"?: (
  input: {
    sessionID: string
    agent?: string
    model?: { providerID: string; modelID: string }
    messageID?: string
    variant?: string
  },
  output: { message: UserMessage; parts: Part[] },
) => Promise<void>
```

#### `chat.params`

Chỉnh sửa tham số gửi đến LLM (temperature, topP, topK, maxOutputTokens, custom options).

```ts
"chat.params"?: (
  input: {
    sessionID: string
    agent: string
    model: Model
    provider: ProviderContext
    message: UserMessage
  },
  output: {
    temperature: number
    topP: number
    topK: number
    maxOutputTokens: number | undefined
    options: Record<string, any>
  },
) => Promise<void>
```

Ví dụ:

```ts
"chat.params": async (input, output) => {
  output.temperature = 0.7
  output.topP = 0.9
}
```

#### `chat.headers`

Chỉnh sửa HTTP headers gửi đến LLM provider.

```ts
"chat.headers"?: (
  input: {
    sessionID: string
    agent: string
    model: Model
    provider: ProviderContext
    message: UserMessage
  },
  output: { headers: Record<string, string> },
) => Promise<void>
```

Ví dụ:

```ts
"chat.headers": async (input, output) => {
  output.headers["X-Custom-Header"] = "value"
}
```

---

### Permission & Command

#### `permission.ask`

Quyết định quyền truy cập khi tool cần permission.

```ts
"permission.ask"?: (
  input: Permission,
  output: { status: "ask" | "deny" | "allow" },
) => Promise<void>
```

Ví dụ - tự động cho phép read tool:

```ts
"permission.ask": async (input, output) => {
  if (input.permission === "read") {
    output.status = "allow"
  }
}
```

#### `command.execute.before`

Inject thêm parts trước khi command được thực thi.

```ts
"command.execute.before"?: (
  input: { command: string; sessionID: string; arguments: string },
  output: { parts: Part[] },
) => Promise<void>
```

---

### Tool

#### `tool`

Đăng ký custom tools cho LLM sử dụng.

```ts
tool?: { [key: string]: ToolDefinition }
```

Ví dụ:

```ts
import { tool } from "@opencode-ai/plugin"

"tool": {
  mytool: tool({
    description: "This is a custom tool",
    args: {
      foo: tool.schema.string(),
    },
    async execute(args, context) {
      const { directory, worktree } = context
      return `Hello ${args.foo} from ${directory}`
    },
  }),
}
```

**ToolContext** bao gồm:

| Field       | Type                       | Mô tả                       |
| ----------- | -------------------------- | --------------------------- |
| `sessionID` | `string`                   | Session ID                  |
| `messageID` | `string`                   | Message ID                  |
| `agent`     | `string`                   | Agent name                  |
| `directory` | `string`                   | Project directory           |
| `worktree`  | `string`                   | Project worktree root       |
| `abort`     | `AbortSignal`              | Signal để cancel            |
| `metadata`  | `(input) => void`          | Set title/metadata cho tool |
| `ask`       | `(input) => Promise<void>` | Yêu cầu permission          |

#### `tool.execute.before`

Sửa arguments trước khi tool chạy.

```ts
"tool.execute.before"?: (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>
```

Ví dụ - chặn đọc file .env:

```ts
"tool.execute.before": async (input, output) => {
  if (input.tool === "read" && output.args.filePath.includes(".env")) {
    throw new Error("Do not read .env files")
  }
}
```

#### `tool.execute.after`

Sửa kết quả sau khi tool chạy xong.

```ts
"tool.execute.after"?: (
  input: { tool: string; sessionID: string; callID: string; args: any },
  output: {
    title: string
    output: string
    metadata: any
  },
) => Promise<void>
```

#### `tool.definition`

Sửa tool description và parameters được gửi đến LLM. Cho phép thay đổi cách LLM nhìn thấy tool mà không cần sửa tool implementation.

```ts
"tool.definition"?: (
  input: { toolID: string },
  output: { description: string; parameters: any },
) => Promise<void>
```

---

### Shell

#### `shell.env`

Inject hoặc sửa environment variables cho tất cả shell execution (AI tools và user terminals).

```ts
"shell.env"?: (
  input: { cwd: string; sessionID?: string; callID?: string },
  output: { env: Record<string, string> },
) => Promise<void>
```

Ví dụ:

```ts
"shell.env": async (input, output) => {
  output.env.MY_API_KEY = "secret"
  output.env.PROJECT_ROOT = input.cwd
}
```

---

### Auth & Provider

#### `auth`

Đăng ký custom authentication provider. Hỗ trợ hai phương thức: OAuth và API Key.

```ts
auth?: AuthHook
```

**AuthHook** structure:

```ts
type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<TextPrompt | SelectPrompt>
        authorize(inputs?: Record<string, string>): Promise<AuthOAuthResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<TextPrompt | SelectPrompt>
        authorize?(
          inputs?: Record<string, string>,
        ): Promise<{ type: "success"; key: string; provider?: string } | { type: "failed" }>
      }
  )[]
}
```

**Rule** type (dùng cho `when`):

```ts
type Rule = {
  key: string
  op: "eq" | "neq"
  value: string
}
```

Prompt types:

```ts
type TextPrompt = {
  type: "text"
  key: string
  message: string
  placeholder?: string
  validate?: (value: string) => string | undefined
  when?: Rule
}

type SelectPrompt = {
  type: "select"
  key: string
  message: string
  options: Array<{ label: string; value: string; hint?: string }>
  when?: Rule
}
```

**AuthOAuthResult** structure:

```ts
type AuthOAuthResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({ type: "success"; provider?: string } & (
            | { refresh: string; access: string; expires: number; accountId?: string; enterpriseUrl?: string }
            | { key: string }
          ))
        | { type: "failed" }
      >
    }
  | {
      method: "code"
      callback(
        code: string,
      ): Promise<
        | ({ type: "success"; provider?: string } & (
            | { refresh: string; access: string; expires: number; accountId?: string; enterpriseUrl?: string }
            | { key: string }
          ))
        | { type: "failed" }
      >
    }
)
```

#### `provider`

Đăng ký custom model provider.

```ts
provider?: ProviderHook
```

**ProviderHook** structure:

```ts
type ProviderHook = {
  id: string
  models?: (provider: ProviderV2, ctx: ProviderHookContext) => Promise<Record<string, ModelV2>>
}
```

---

### Experimental

> Các hooks dưới đây mang nhãn experimental và có thể thay đổi trong tương lai.

#### `experimental.chat.messages.transform`

Transform toàn bộ messages trước khi gửi đến LLM.

```ts
"experimental.chat.messages.transform"?: (
  input: {},
  output: {
    messages: {
      info: Message
      parts: Part[]
    }[]
  },
) => Promise<void>
```

#### `experimental.chat.system.transform`

Sửa system prompt gửi đến LLM.

```ts
"experimental.chat.system.transform"?: (
  input: { sessionID?: string; model: Model },
  output: {
    system: string[]
  },
) => Promise<void>
```

#### `experimental.session.compacting`

Tùy chỉnh compaction prompt khi session bị compact. Cho phép inject thêm context hoặc thay thế hoàn toàn prompt.

```ts
"experimental.session.compacting"?: (
  input: { sessionID: string },
  output: { context: string[]; prompt?: string },
) => Promise<void>
```

Ví dụ - inject thêm context:

```ts
"experimental.session.compacting": async (input, output) => {
  output.context.push(`
## Custom Context
- Current task status
- Important decisions made
- Files being actively worked on
  `)
}
```

Ví dụ - thay thế toàn bộ prompt:

```ts
"experimental.session.compacting": async (input, output) => {
  output.prompt = `
You are generating a continuation prompt.
Summarize:
1. The current task and its status
2. Which files are being modified
3. The next steps to complete the work
  `
}
```

> Khi `output.prompt` được set, nó thay thế hoàn toàn default compaction prompt. `output.context` bị bỏ qua trong trường hợp này.

#### `experimental.text.complete`

Sửa text completion output.

```ts
"experimental.text.complete"?: (
  input: { sessionID: string; messageID: string; partID: string },
  output: { text: string },
) => Promise<void>
```

---

## Toàn bộ Events

Danh sách đầy đủ 45 event types có thể subscribe qua hook `event` (server) hoặc `api.event.on` (TUI).

### Project Events

| Event Type        | Properties       |
| ----------------- | ---------------- |
| `project.updated` | `Project` object |

### Installation Events

| Event Type                      | Properties            |
| ------------------------------- | --------------------- |
| `installation.updated`          | `{ version: string }` |
| `installation.update-available` | `{ version: string }` |

### Server Events

| Event Type                 | Properties              |
| -------------------------- | ----------------------- |
| `server.connected`         | `{}`                    |
| `server.instance.disposed` | `{ directory: string }` |
| `global.disposed`          | `{}`                    |

### LSP Events

| Event Type               | Properties                           |
| ------------------------ | ------------------------------------ |
| `lsp.client.diagnostics` | `{ serverID: string, path: string }` |
| `lsp.updated`            | `{}`                                 |

### Message Events

| Event Type             | Properties                                       |
| ---------------------- | ------------------------------------------------ |
| `message.updated`      | `{ sessionID, info: Message }`                   |
| `message.removed`      | `{ sessionID, messageID }`                       |
| `message.part.delta`   | `{ sessionID, messageID, partID, field, delta }` |
| `message.part.updated` | `{ sessionID, part: Part, time }`                |
| `message.part.removed` | `{ sessionID, messageID, partID }`               |

### Permission Events

| Event Type           | Properties                                                    |
| -------------------- | ------------------------------------------------------------- |
| `permission.asked`   | `PermissionRequest` object                                    |
| `permission.replied` | `{ sessionID, requestID, reply: "once"\|"always"\|"reject" }` |

### Question Events

| Event Type          | Properties                          |
| ------------------- | ----------------------------------- |
| `question.asked`    | `QuestionRequest` object            |
| `question.replied`  | `{ sessionID, requestID, answers }` |
| `question.rejected` | `{ sessionID, requestID }`          |

### Session Events

| Event Type          | Properties                             |
| ------------------- | -------------------------------------- |
| `session.created`   | `{ sessionID, info: Session }`         |
| `session.updated`   | `{ sessionID, info: Session }`         |
| `session.deleted`   | `{ sessionID, info: Session }`         |
| `session.status`    | `{ sessionID, status: SessionStatus }` |
| `session.idle`      | `{ sessionID }`                        |
| `session.compacted` | `{ sessionID }`                        |
| `session.diff`      | `{ sessionID, diff: FileDiff[] }`      |
| `session.error`     | `{ sessionID?, error? }`               |

### File Events

| Event Type             | Properties                                           |
| ---------------------- | ---------------------------------------------------- |
| `file.edited`          | `{ file: string }`                                   |
| `file.watcher.updated` | `{ file: string, event: "add"\|"change"\|"unlink" }` |

### Todo Events

| Event Type     | Properties                     |
| -------------- | ------------------------------ |
| `todo.updated` | `{ sessionID, todos: Todo[] }` |

### Command Events

| Event Type         | Properties                                  |
| ------------------ | ------------------------------------------- |
| `command.executed` | `{ name, sessionID, arguments, messageID }` |

### MCP Events

| Event Type                | Properties           |
| ------------------------- | -------------------- |
| `mcp.tools.changed`       | `{ server: string }` |
| `mcp.browser.open.failed` | `{ mcpName, url }`   |

### VCS Events

| Event Type           | Properties            |
| -------------------- | --------------------- |
| `vcs.branch.updated` | `{ branch?: string }` |

### Workspace Events

| Event Type         | Properties            |
| ------------------ | --------------------- |
| `workspace.ready`  | `{ name: string }`    |
| `workspace.failed` | `{ message: string }` |

### Worktree Events

| Event Type        | Properties         |
| ----------------- | ------------------ |
| `worktree.ready`  | `{ name, branch }` |
| `worktree.failed` | `{ message }`      |

### PTY Events

| Event Type    | Properties         |
| ------------- | ------------------ |
| `pty.created` | `{ info: Pty }`    |
| `pty.updated` | `{ info: Pty }`    |
| `pty.exited`  | `{ id, exitCode }` |
| `pty.deleted` | `{ id }`           |

### TUI Events

| Event Type            | Properties                                |
| --------------------- | ----------------------------------------- |
| `tui.prompt.append`   | `{ text: string }`                        |
| `tui.command.execute` | `{ command: string \| enum }`             |
| `tui.toast.show`      | `{ title?, message, variant, duration? }` |
| `tui.session.select`  | `{ sessionID }`                           |

**`tui.command.execute` enum values:**

`session.list`, `session.new`, `session.share`, `session.interrupt`, `session.compact`, `session.page.up`, `session.page.down`, `session.line.up`, `session.line.down`, `session.half.page.up`, `session.half.page.down`, `session.first`, `session.last`, `prompt.clear`, `prompt.submit`, `agent.cycle`, hoặc bất kỳ `string` nào khác.

---

## TUI Plugin API

TUI plugin nhận `api` object trong hàm `tui(api, options, meta)`:

```ts
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api, options, meta) => {
  // Use api.* here
}

const plugin: TuiPluginModule = {
  id: "my.plugin",
  tui,
}

export default plugin
```

### Command API

Đăng ký commands vào command palette.

```ts
api.command.register(cb: () => TuiCommand[]): () => void
api.command.trigger(value: string): void
api.command.show(): void
```

**TuiCommand** fields:

| Field         | Type          | Mô tả                                  |
| ------------- | ------------- | -------------------------------------- |
| `title`       | `string`      | Tiêu đề hiển thị                       |
| `value`       | `string`      | Giá trị unique                         |
| `description` | `string?`     | Mô tả                                  |
| `category`    | `string?`     | Danh mục                               |
| `keybind`     | `string?`     | Phím tắt                               |
| `suggested`   | `boolean?`    | Hiển thị như gợi ý                     |
| `hidden`      | `boolean?`    | Ẩn khỏi dialog nhưng vẫn hoạt động     |
| `enabled`     | `boolean?`    | Bật/tắt command                        |
| `slash`       | `object?`     | `{ name, aliases? }` cho slash command |
| `onSelect`    | `() => void?` | Callback khi chọn                      |

Ví dụ:

```ts
const unregister = api.command.register(() => [
  {
    title: "My Command",
    value: "my.command",
    keybind: "ctrl+m",
    onSelect: () => api.route.navigate("my-route"),
  },
])
```

> `register` trả về hàm `unregister`. Registrations là reactive. Registration sau ghi đè registration trước nếu trùng `value`.

### Route API

Đăng ký routes (trang) trong TUI.

```ts
api.route.register(routes: TuiRouteDefinition[]): () => void
api.route.navigate(name: string, params?: Record<string, unknown>): void
api.route.current // => TuiRouteCurrent
```

**Reserved route names:** `home`, `session`

```ts
api.route.register([
  {
    name: "my-route",
    render: ({ params }) => (
      <box>
        <text>My Route</text>
      </box>
    ),
  },
])
```

**TuiRouteCurrent** types:

```ts
| { name: "home" }
| { name: "session", params: { sessionID, initialPrompt? } }
| { name: string, params?: Record<string, unknown> }
```

### UI API

Components và utilities cho UI.

```ts
api.ui.Dialog // Base dialog wrapper
api.ui.DialogAlert // Alert dialog
api.ui.DialogConfirm // Confirm dialog
api.ui.DialogPrompt // Prompt dialog
api.ui.DialogSelect // Select dialog
api.ui.Slot // Render slots
api.ui.Prompt // Prompt component
api.ui.toast(input) // Show toast
api.ui.dialog // Dialog stack
```

**Toast:**

```ts
api.ui.toast({
  variant: "info", // "info" | "success" | "warning" | "error"
  title: "Title",
  message: "Message",
  duration: 5000,
})
```

**Dialog Stack:**

```ts
api.ui.dialog.replace(render, onClose?) // Thay thế dialog hiện tại
api.ui.dialog.clear()                    // Đóng tất cả dialogs
api.ui.dialog.setSize("medium")          // "medium" | "large" | "xlarge"
api.ui.dialog.size     // readonly current size
api.ui.dialog.depth    // readonly stack depth
api.ui.dialog.open     // readonly boolean
```

### Keybind API

Quản lý phím tắt cho plugin.

```ts
api.keybind.match(key: string, evt: ParsedKey): boolean
api.keybind.print(key: string): string
api.keybind.create(defaults: TuiKeybindMap, overrides?: Record<string, unknown>): TuiKeybindSet
```

**TuiKeybindSet:**

```ts
{
  all: TuiKeybindMap     // Tất cả keybinds
  get(name: string): string
  match(name: string, evt: ParsedKey): boolean
  print(name: string): string
}
```

### KV Store

Key-value store dùng chung, backed bởi `state/kv.json`. Không plugin-namespaced.

```ts
api.kv.get<Value = unknown>(key: string, fallback?: Value): Value
api.kv.set(key: string, value: unknown): void
api.kv.ready // boolean
```

### State API

Trạng thái đồng bộ từ host app.

```ts
api.state.ready // boolean
api.state.config // SdkConfig (live)
api.state.provider // ReadonlyArray<Provider>
api.state.path.state // string
api.state.path.config // string
api.state.path.worktree // string
api.state.path.directory // string
api.state.vcs?.branch // string | undefined
```

**Workspace:**

```ts
api.state.workspace.list(): ReadonlyArray<Workspace>
api.state.workspace.get(workspaceID: string): Workspace | undefined
```

**Session:**

```ts
api.state.session.count(): number
api.state.session.diff(sessionID: string): ReadonlyArray<TuiSidebarFileItem>
api.state.session.todo(sessionID: string): ReadonlyArray<TuiSidebarTodoItem>
api.state.session.messages(sessionID: string): ReadonlyArray<Message>
api.state.session.status(sessionID: string): SessionStatus | undefined
api.state.session.permission(sessionID: string): ReadonlyArray<PermissionRequest>
api.state.session.question(sessionID: string): ReadonlyArray<QuestionRequest>
```

**Other:**

```ts
api.state.part(messageID: string): ReadonlyArray<Part>
api.state.lsp(): ReadonlyArray<TuiSidebarLspItem>
api.state.mcp(): ReadonlyArray<TuiSidebarMcpItem>
```

### Theme API

Quản lý theme cho TUI.

```ts
api.theme.current   // TuiThemeCurrent - resolved theme tokens
api.theme.selected  // string - selected theme name
api.theme.has(name: string): boolean
api.theme.set(name: string): boolean
api.theme.install(jsonPath: string): Promise<void>
api.theme.mode(): "dark" | "light"
api.theme.ready     // boolean
```

**Theme tokens** bao gồm: `primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`, `text`, `textMuted`, `selectedListItemText`, `background`, `backgroundPanel`, `backgroundElement`, `backgroundMenu`, `border`, `borderActive`, `borderSubtle`, `diffAdded`, `diffRemoved`, `diffContext`, `diffHunkHeader`, `diffHighlightAdded`, `diffHighlightRemoved`, `diffAddedBg`, `diffRemovedBg`, `diffContextBg`, `diffLineNumber`, `diffAddedLineNumberBg`, `diffRemovedLineNumberBg`, `markdownText`, `markdownHeading`, `markdownLink`, `markdownLinkText`, `markdownCode`, `markdownBlockQuote`, `markdownEmph`, `markdownStrong`, `markdownHorizontalRule`, `markdownListItem`, `markdownListEnumeration`, `markdownImage`, `markdownImageText`, `markdownCodeBlock`, `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`, `thinkingOpacity`.

### App API

```ts
api.app // { readonly version: string }
```

### Client API

```ts
api.client            // OpencodeClient - runtime hiện tại
api.scopedClient(workspaceID?: string) // Client bound đến workspace
```

### TUI Config

```ts
api.tuiConfig // Frozen<TuiConfigView> - frozen TUI-specific config
```

Fields bao gồm: `$schema`, `theme`, `keybinds`, `plugin`, `plugin_enabled` (Record<string, boolean>), và các TUI config fields.

### Workspace API

```ts
api.workspace.current(): string | undefined
api.workspace.set(workspaceID?: string): void
```

### Event Bus

Subscribe events từ TUI plugin.

```ts
api.event.on<Type extends Event["type"]>(
  type: Type,
  handler: (event: Extract<Event, { type: Type }>) => void
): () => void // unsubscribe function
```

### Renderer

Raw CLI renderer access.

```ts
api.renderer // CliRenderer
```

### Slots API

Đăng ký UI slots để render vào các vị trí trong host app.

```ts
api.slots.register(plugin: TuiSlotPlugin): string
```

**Host Slot Names:**

| Slot Name              | Props                                                   | Render Mode   |
| ---------------------- | ------------------------------------------------------- | ------------- |
| `app`                  | `{}`                                                    | default       |
| `home_logo`            | `{}`                                                    | replace       |
| `home_prompt`          | `{ workspace_id?, ref? }`                               | replace       |
| `home_prompt_right`    | `{ workspace_id? }`                                     | default       |
| `session_prompt`       | `{ session_id, visible?, disabled?, on_submit?, ref? }` | replace       |
| `session_prompt_right` | `{ session_id }`                                        | default       |
| `home_bottom`          | `{}`                                                    | default       |
| `home_footer`          | `{}`                                                    | single_winner |
| `sidebar_title`        | `{ session_id, title, share_url? }`                     | single_winner |
| `sidebar_content`      | `{ session_id }`                                        | default       |
| `sidebar_footer`       | `{ session_id }`                                        | single_winner |

> Plugins cũng có thể define custom slot names và render bằng `ui.Slot`.

### Plugin Control

```ts
api.plugins.list(): ReadonlyArray<TuiPluginStatus>
api.plugins.activate(id: string): Promise<boolean>
api.plugins.deactivate(id: string): Promise<boolean>
api.plugins.add(spec: string): Promise<boolean>
api.plugins.install(spec: string, options?: { global?: boolean }): Promise<TuiPluginInstallResult>
```

**TuiPluginStatus:**

```ts
{
  id: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  enabled: boolean
  active: boolean
}
```

### Lifecycle API

Quản lý vòng đời plugin.

```ts
api.lifecycle.signal       // AbortSignal - aborted trước khi cleanup
api.lifecycle.onDispose(fn: () => void | Promise<void>): () => void
```

---

## TuiPluginMeta

Metadata truyền vào hàm `tui(api, options, meta)`:

```ts
type TuiPluginMeta = {
  state: "first" | "updated" | "same"
  id: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  // npm-only
  requested?: string
  version?: string
  // file-only
  modified?: number
  // tracking
  first_time: number
  last_time: number
  time_changed: number
  load_count: number
  fingerprint: string
}
```

---

## Ví dụ Plugin

### Server Plugin - Gửi notification khi session hoàn thành

```js
export const NotificationPlugin = async ({ client, $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```

### Server Plugin - Bảo vệ file .env

```js
export const EnvProtection = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
```

### Server Plugin - Inject environment variables

```js
export const InjectEnvPlugin = async () => {
  return {
    "shell.env": async (input, output) => {
      output.env.MY_API_KEY = "secret"
      output.env.PROJECT_ROOT = input.cwd
    },
  }
}
```

### Server Plugin - Custom tools

```ts
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string(),
        },
        async execute(args, context) {
          return `Hello ${args.foo} from ${context.directory}`
        },
      }),
    },
  }
}
```

### Server Plugin - Compaction hooks

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const CompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(`
## Custom Context
Include any state that should persist across compaction:
- Current task status
- Important decisions made
- Files being actively worked on
      `)
    },
  }
}
```

### Server Plugin - Auth Provider (OAuth)

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyAuthProvider: Plugin = async () => {
  return {
    auth: {
      provider: "my-provider",
      methods: [
        {
          type: "oauth",
          label: "My Provider",
          authorize() {
            return {
              method: "code",
              url: "https://example.com/oauth/authorize",
              instructions: "Visit the URL and paste the code",
              async callback(code) {
                return {
                  type: "success",
                  access: "access_token",
                  refresh: "refresh_token",
                  expires: Date.now() + 3600000,
                }
              },
            }
          },
        },
      ],
    },
  }
}
```

### TUI Plugin - Đăng ký route và command

```tsx
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api, options, meta) => {
  api.command.register(() => [
    {
      title: "My Page",
      value: "my.open",
      onSelect: () => api.route.navigate("my-page"),
    },
  ])

  api.route.register([
    {
      name: "my-page",
      render: () => (
        <box>
          <text>Hello from my plugin!</text>
        </box>
      ),
    },
  ])

  api.lifecycle.onDispose(() => {
    console.log("Plugin disposed")
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "my.plugin",
  tui,
}

export default plugin
```

### TUI Plugin - Subscribe events

```tsx
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api) => {
  const unsub = api.event.on("session.idle", (event) => {
    api.ui.toast({
      variant: "success",
      message: "Session completed!",
    })
  })

  api.lifecycle.onDispose(() => {
    unsub()
  })
}

export default { id: "my.events", tui }
```

---

## Tóm tắt

| Cách tác động          | Hook / API                                  | Loại Plugin |
| ---------------------- | ------------------------------------------- | ----------- |
| Quan sát events        | `event`                                     | Server      |
| Config thay đổi        | `config`                                    | Server      |
| Sửa tham số LLM        | `chat.params`, `chat.headers`               | Server      |
| Sửa system prompt      | `experimental.chat.system.transform`        | Server      |
| Transform messages     | `experimental.chat.messages.transform`      | Server      |
| Đăng ký custom tools   | `tool`                                      | Server      |
| Sửa tool args/kết quả  | `tool.execute.before`, `tool.execute.after` | Server      |
| Sửa tool definition    | `tool.definition`                           | Server      |
| Inject shell env       | `shell.env`                                 | Server      |
| Quyết định permission  | `permission.ask`                            | Server      |
| Inject command parts   | `command.execute.before`                    | Server      |
| Tùy chỉnh compaction   | `experimental.session.compacting`           | Server      |
| Sửa text completion    | `experimental.text.complete`                | Server      |
| Đăng ký auth provider  | `auth`                                      | Server      |
| Đăng ký model provider | `provider`                                  | Server      |
| Đăng ký TUI commands   | `api.command.register`                      | TUI         |
| Đăng ký TUI routes     | `api.route.register`                        | TUI         |
| Tạo UI dialogs         | `api.ui.*`                                  | TUI         |
| Đăng ký keybinds       | `api.keybind.create`                        | TUI         |
| Quản lý themes         | `api.theme.*`                               | TUI         |
| Render vào slots       | `api.slots.register`                        | TUI         |
| KV store               | `api.kv.*`                                  | TUI         |
| Truy cập state         | `api.state.*`                               | TUI         |
| SDK client             | `api.client`, `api.scopedClient`            | TUI         |
| App info               | `api.app`                                   | TUI         |
| TUI config             | `api.tuiConfig`                             | TUI         |
| Subscribe events       | `api.event.on`                              | TUI         |
| Quản lý plugins khác   | `api.plugins.*`                             | TUI         |
| Lifecycle management   | `api.lifecycle.*`                           | TUI         |
