# Plugin Reference Validation Report

So sánh chi tiết `OPENCODE_PLUGIN_REFERENCE.md` với source code thực tế.

**Source files kiểm tra:**
- [index.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/index.ts) — Server plugin types (Hooks, AuthHook, ProviderHook, etc.)
- [tool.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tool.ts) — Tool definitions & context
- [tui.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts) — TUI plugin types (TuiPluginApi, etc.)
- [types.gen.ts](file:///Users/ryanho/Dev/opencode/packages/sdk/js/src/v2/gen/types.gen.ts) — Generated SDK types (Event union, etc.)
- [runtime.ts](file:///Users/ryanho/Dev/opencode/packages/opencode/src/cli/cmd/tui/plugin/runtime.ts) — TUI plugin runtime implementation

---

## ✅ Phần CHÍNH XÁC (Matches)

### Server Plugin Hooks
| Hook | Status | Ghi chú |
|------|--------|---------|
| `event` | ✅ Match | Signature chính xác |
| `config` | ✅ Match | Signature chính xác |
| `chat.message` | ✅ Match | Input/output chính xác |
| `chat.params` | ✅ Match | Input/output chính xác |
| `chat.headers` | ✅ Match | Input/output chính xác |
| `permission.ask` | ✅ Match | Signature chính xác |
| `command.execute.before` | ✅ Match | Signature chính xác |
| `tool` (custom tools) | ✅ Match | Object `{ [key: string]: ToolDefinition }` |
| `tool.execute.before` | ✅ Match | Signature chính xác |
| `tool.execute.after` | ✅ Match | Signature chính xác |
| `tool.definition` | ✅ Match | Signature chính xác |
| `shell.env` | ✅ Match | Signature chính xác |
| `auth` | ✅ Match | `AuthHook` type chính xác |
| `provider` | ✅ Match | `ProviderHook` type chính xác |
| `experimental.chat.messages.transform` | ✅ Match | Signature chính xác |
| `experimental.chat.system.transform` | ✅ Match | Signature chính xác |
| `experimental.session.compacting` | ✅ Match | Signature chính xác |
| `experimental.text.complete` | ✅ Match | Signature chính xác |

### Type Definitions  
| Type | Status | Ghi chú |
|------|--------|---------|
| `Plugin` | ✅ Match | `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>` |
| `PluginModule` | ✅ Match | `{ id?: string; server: Plugin; tui?: never }` |
| `PluginInput` | ✅ Match | 6 fields chính xác |
| `PluginOptions` | ✅ Match | `Record<string, unknown>` |
| `ProviderContext` | ✅ Match | `{ source, info, options }` |
| `AuthHook` | ✅ Match | Cấu trúc phức tạp khớp hoàn toàn |
| `AuthOAuthResult` | ✅ Match | Cả `auto` và `code` methods |
| `AuthOuathResult` (deprecated) | ✅ Match | Alias đã được ghi chú |
| `Rule` | ✅ Match | `{ key, op, value }` |
| `TextPrompt` / `SelectPrompt` | ✅ Match | Bao gồm `when`, `condition` (deprecated) |
| `ProviderHook` | ✅ Match | `{ id, models? }` |
| `ProviderHookContext` | ✅ Match | `{ auth?: Auth }` |
| `ToolContext` | ✅ Match | Tất cả 7 fields + `ask` method |
| `AskInput` | ✅ Match | `{ permission, patterns, always, metadata }` |
| `tool.schema` | ✅ Match | Chính là `z` (zod) |

### TUI Plugin Types
| Type | Status | Ghi chú |
|------|--------|---------|
| `TuiPlugin` | ✅ Match | `(api, options, meta) => Promise<void>` |
| `TuiPluginModule` | ✅ Match | `{ id?, tui, server?: never }` |
| `TuiPluginApi` | ✅ Match | Tất cả API methods khớp |
| `TuiCommand` | ✅ Match | Tất cả fields khớp |
| `TuiRouteCurrent` | ✅ Match | 3 variants khớp |
| `TuiRouteDefinition` | ✅ Match | `{ name, render }` |
| `TuiDialogStack` | ✅ Match | `replace`, `clear`, `setSize`, `size`, `depth`, `open` |
| `TuiToast` | ✅ Match | `{ variant?, title?, message, duration? }` |
| `TuiTheme` / `TuiThemeCurrent` | ✅ Match | Tất cả theme tokens khớp |
| `TuiKV` | ✅ Match | `get`, `set`, `ready` |
| `TuiState` | ✅ Match | `ready`, `config`, `provider`, `path`, `vcs`, `session.*`, `part`, `lsp`, `mcp` |
| `TuiKeybindSet` | ✅ Match | `all`, `get`, `match`, `print` |
| `TuiPluginMeta` | ✅ Match | Tất cả fields khớp |
| `TuiPluginStatus` | ✅ Match | `id`, `source`, `spec`, `target`, `enabled`, `active` |
| `TuiEventBus` | ✅ Match | `on` method khớp |
| `TuiLifecycle` | ✅ Match | `signal`, `onDispose` |
| `TuiApp` | ✅ Match | `{ readonly version: string }` |
| `TuiHostSlotMap` | ✅ Match | Tất cả 11 slot names và props khớp |

### Event Types (46 events)
| Category | Count | Status |
|----------|-------|--------|
| Project | 1 | ✅ Match |
| Installation | 2 | ✅ Match |
| Server | 3 | ✅ Match |
| LSP | 2 | ✅ Match |
| Message | 5 | ✅ Match |
| Permission | 2 | ✅ Match |
| Question | 3 | ✅ Match |
| Session | 8 | ✅ Match |
| File | 2 | ✅ Match |
| Todo | 1 | ✅ Match |
| Command | 1 | ✅ Match |
| MCP | 2 | ✅ Match |
| VCS | 1 | ✅ Match |
| Workspace | 3 | ✅ Match |
| Worktree | 2 | ✅ Match |
| PTY | 4 | ✅ Match |
| TUI | 4 | ✅ Match |
| **Total** | **46** | ✅ Match |

---

## ⚠️ Phần KHÔNG CHÍNH XÁC (Mismatches)

### 1. `session.diff` event — Sai tên type `FileDiff`

> [!WARNING]
> Doc dùng `FileDiff[]` nhưng SDK thực tế dùng `SnapshotFileDiff[]`.

**Doc (line 680):**
```
| `session.diff` | `{ sessionID, diff: FileDiff[] }` |
```

**Actual SDK** ([types.gen.ts:134-140](file:///Users/ryanho/Dev/opencode/packages/sdk/js/src/v2/gen/types.gen.ts#L134-L140)):
```ts
export type EventSessionDiff = {
  type: "session.diff"
  properties: {
    sessionID: string
    diff: Array<SnapshotFileDiff>
  }
}
```

**Sửa:** Đổi `FileDiff[]` → `SnapshotFileDiff[]`.

---

### 2. `session.error` event — Thiếu chi tiết error types

> [!NOTE]
> Doc chỉ ghi `{ sessionID?, error? }` nhưng thực tế `error` là union type phức tạp.

**Doc (line 681):**
```
| `session.error` | `{ sessionID?, error? }` |
```

**Actual SDK** ([types.gen.ts:203-216](file:///Users/ryanho/Dev/opencode/packages/sdk/js/src/v2/gen/types.gen.ts#L203-L216)):
```ts
export type EventSessionError = {
  type: "session.error"
  properties: {
    sessionID?: string
    error?:
      | ProviderAuthError
      | UnknownError
      | MessageOutputLengthError
      | MessageAbortedError
      | StructuredOutputError
      | ContextOverflowError
      | ApiError
  }
}
```

**Nhận xét:** Doc signature simplify hợp lý cho table overview, nhưng thiếu thông tin kiểu thực tế của `error`. Có thể thêm note hoặc link chi tiết.

---

### 3. Event count — Doc nói "46 event types" — ✅ Chính xác

Đếm thực tế Event union trong SDK = **46 members**. Khớp.

---

### 4. Slot `home_footer` và `sidebar_footer` — render mode `single_winner`

> [!NOTE]
> Doc ghi render mode nhưng `SlotMode` type trong `@opentui/core` cần xác minh có `single_winner` hay không.

Doc (line 1034-1037):
```
| `home_footer`    | `{}`                               | single_winner |
| `sidebar_footer` | `{ session_id }`                   | single_winner |
```

Tuy nhiên, `TuiHostSlotMap` trong [tui.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts) không định nghĩa render mode — nó chỉ là type-level definition. Render mode được set trong actual host implementation (slots.tsx). **Type-level: OK, runtime cần kiểm chứng riêng.**

---

## 📋 Phần THIẾU trong doc (Missing from Doc)

### 1. `TuiWorkspace` type — Exported nhưng chưa dùng trong API

> [!NOTE]
> `TuiWorkspace` type được export từ `tui.ts` nhưng KHÔNG có trong `TuiPluginApi`. Đây là internal type, không cần document cho plugin authors.

**Source** ([tui.ts:445-448](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L445-L448)):
```ts
export type TuiWorkspace = {
  current: () => string | undefined
  set: (workspaceID?: string) => void
}
```

**Kết luận:** Không phải mismatch — type được export nhưng chưa thêm vào `TuiPluginApi`. Có thể là API planned cho future.

---

### 2. `TuiPromptInfo`, `TuiPromptRef`, `TuiPromptProps` — Thiếu chi tiết

> [!NOTE]
> Doc nhắc đến `api.ui.Prompt` component nhưng không document chi tiết props.

**Exported types** ([tui.ts:141-183](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L141-L183)):
- `TuiPromptInfo`: `{ input, mode?, parts }` 
- `TuiPromptRef`: `{ focused, current, set(), reset(), blur(), focus(), submit() }`
- `TuiPromptProps`: `{ sessionID?, workspaceID?, visible?, disabled?, onSubmit?, ref?, hint?, right?, showPlaceholder?, placeholders? }`

Đây là các types phức tạp cần document, đặc biệt để plugin authors hiểu cách sử dụng `api.ui.Prompt`.

---

### 3. `TuiDialogProps` detailed — Thiếu `children` prop

Doc liệt kê Dialog nhưng không document full `TuiDialogProps`:

**Source** ([tui.ts:80-84](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L80-L84)):
```ts
export type TuiDialogProps = {
  size?: "medium" | "large" | "xlarge"
  onClose: () => void
  children?: JSX.Element
}
```

---

### 4. `TuiDialogSelectOption`, `TuiDialogSelectProps`, `TuiDialogPromptProps` — Thiếu chi tiết

Doc chỉ liệt kê tên component nhưng không document đầy đủ props. Các type thực tế rất phong phú:

- `TuiDialogSelectOption<Value>`: `title`, `value`, `description?`, `footer?`, `category?`, `disabled?`, `onSelect?`
- `TuiDialogSelectProps<Value>`: `title`, `placeholder?`, `options`, `flat?`, `onMove?`, `onFilter?`, `onSelect?`, `skipFilter?`, `current?`
- `TuiDialogPromptProps`: `title`, `description?`, `placeholder?`, `value?`, `busy?`, `busyText?`, `onConfirm?`, `onCancel?`

---

### 5. `TuiPluginInstallResult` — Doc thiếu `missing` field cho error case

**Doc (line 1048):**
```ts
api.plugins.install(spec: string, options?: { global?: boolean }): Promise<TuiPluginInstallResult>
```

Nhưng không document `TuiPluginInstallResult` type.

**Actual** ([tui.ts:433-443](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L433-L443)):
```ts
export type TuiPluginInstallResult =
  | { ok: true; dir: string; tui: boolean }
  | { ok: false; message: string; missing?: boolean }
```

---

### 6. `TuiKeybind` type — Exported nhưng undocumented

**Source** ([tui.ts:62-69](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L62-L69)):
```ts
export type TuiKeybind = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
  leader: boolean
}
```

---

### 7. `TuiDialogAlertProps`, `TuiDialogConfirmProps` — Undocumented Props

Doc chỉ ghi tên component, không document props:

- `TuiDialogAlertProps`: `{ title, message, onConfirm? }`
- `TuiDialogConfirmProps`: `{ title, message, onConfirm?, onCancel? }`

---

### 8. `BunShell` type — Exported nhưng chi tiết undocumented

[shell.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/shell.ts) exports `BunShell`, `BunShellPromise`, `BunShellOutput`, `BunShellError` với API phong phú. Doc chỉ ghi `$: BunShell` trong PluginInput table nhưng không document API chi tiết.

---

### 9. `PluginConfig` import trong `TuiConfigView`

Doc (line 994):
```
Fields bao gồm: `$schema`, `theme`, `keybinds`, `plugin`, `plugin_enabled` (Record<string, boolean>)
```

**Actual** ([tui.ts:289-292](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L289-L292)):
```ts
type TuiConfigView = Pick<PluginConfig, "$schema" | "theme" | "keybinds" | "plugin"> &
  NonNullable<PluginConfig["tui"]> & {
    plugin_enabled?: Record<string, boolean>
  }
```

Doc đã ghi đúng fields nhưng cũng ghi "cùng các fields từ `NonNullable<PluginConfig["tui"]>`" - đây chưa rõ ràng lắm cho plugin authors vì không biết PluginConfig["tui"] có những gì.

---

## 📊 Tổng kết

| Phân loại | Count | Chi tiết |
|-----------|-------|----------|
| ✅ Chính xác hoàn toàn | **~85%** | Server hooks, TUI API signatures, Event types, PluginInput/PluginModule, AuthHook, ToolContext... |
| ⚠️ Sai/Không chính xác | **2** | `FileDiff` → `SnapshotFileDiff`, `session.error` thiếu error type detail |
| 📋 Thiếu documentation | **9** | TuiPromptProps/Ref, Dialog props, TuiPluginInstallResult, TuiKeybind, BunShell detail, TuiConfig["tui"] detail |

> [!IMPORTANT]
> **Mismatch nghiêm trọng duy nhất là `FileDiff` → `SnapshotFileDiff`** ở event `session.diff`. Các thiếu khác chủ yếu là thiếu documentation chi tiết cho complex types — plugin authors có thể gặp khó khi cần dùng các API này.

> [!TIP]
> Doc nhìn chung **rất chính xác** — tất cả hook signatures, TUI API methods, Event types đều khớp 1:1 với source code. Đây là chất lượng documentation rất tốt.
