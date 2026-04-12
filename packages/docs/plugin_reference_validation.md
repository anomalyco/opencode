# Plugin Reference Validation Report

Validation of [OPENCODE_PLUGIN_REFERENCE.md](file:///Users/ryanho/Dev/opencode/packages/docs/OPENCODE_PLUGIN_REFERENCE.md) against the actual SDK plugin source at `packages/plugin/src/`.

## Source Files Compared

| Doc Section | Source File |
|---|---|
| Server Plugin types | [index.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/index.ts) |
| Tool types | [tool.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tool.ts) |
| TUI Plugin types | [tui.ts](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts) |
| TUI API impl | [api.tsx](file:///Users/ryanho/Dev/opencode/packages/opencode/src/cli/cmd/tui/plugin/api.tsx) |
| TUI Runtime impl | [runtime.ts](file:///Users/ryanho/Dev/opencode/packages/opencode/src/cli/cmd/tui/plugin/runtime.ts) |
| Event types | [types.gen.ts](file:///Users/ryanho/Dev/opencode/packages/sdk/js/src/v2/gen/types.gen.ts) |

---

## Critical Mismatches 🔴

### 1. `ToolContext.ask` — Wrong Return Type

> [!CAUTION]
> Doc says `ask: (input) => Promise<void>` but the actual type is `ask(input: AskInput): Effect.Effect<void>`.

**Doc** (line 308):
```ts
ask: (input) => Promise<void> // Yêu cầu permission
```

**Actual** ([tool.ts:20](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tool.ts#L20)):
```ts
ask(input: AskInput): Effect.Effect<void>
```

This is a **critical mismatch** — the return type is `Effect.Effect<void>` (from the `effect` library), not `Promise<void>`. Plugin authors using the doc will write incorrect code.

---

### 2. `ToolContext.ask` — Missing `AskInput` Type Definition

> [!WARNING]
> The doc omits the `AskInput` type entirely. It vaguely says "Yêu cầu permission" but doesn't document the shape.

**Actual** ([tool.ts:23-28](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tool.ts#L23-L28)):
```ts
type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}
```

---

### 3. `api.scopedClient` — Does NOT Exist

> [!CAUTION]
> The doc claims `api.scopedClient(workspaceID?)` exists at lines 951-953 but this method does **not** exist in `TuiPluginApi`.

**Doc** (line 952):
```ts
api.scopedClient(workspaceID?: string) // Client bound đến workspace
```

**Actual** ([tui.ts:450-494](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L450-L494)):
The `TuiPluginApi` type only has `client: OpencodeClient`. There is **no** `scopedClient` method anywhere in the codebase (confirmed via full grep).

---

### 4. `api.state.workspace` — Does NOT Exist

> [!CAUTION]
> The doc at lines 899-904 claims `api.state.workspace.list()` and `api.state.workspace.get()` exist but the `TuiState` type has no `workspace` property.

**Doc** (lines 899-904):
```ts
api.state.workspace.list(): ReadonlyArray<Workspace>
api.state.workspace.get(workspaceID: string): Workspace | undefined
```

**Actual** ([tui.ts:264-287](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L264-L287)):
`TuiState` has `session`, `part`, `lsp`, `mcp`, `ready`, `config`, `provider`, `path`, `vcs` — but **no** `workspace`.

---

### 5. `api.workspace` — Does NOT Exist on `TuiPluginApi`

> [!CAUTION]
> The doc at lines 963-968 claims `api.workspace.current()` and `api.workspace.set()` exist.

**Doc** (lines 963-968):
```ts
api.workspace.current(): string | undefined
api.workspace.set(workspaceID?: string): void
```

**Actual**: While the type `TuiWorkspace` is defined in [tui.ts:445-448](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L445-L448), it is **never** added to `TuiPluginApi`. The `TuiPluginApi` type (lines 450-494) does not include a `workspace` property. This type appears to be an orphan.

---

## Moderate Mismatches 🟡

### 6. Auth Prompts — Missing `condition` Field (Deprecated)

> [!IMPORTANT]
> The actual auth prompt types include a deprecated `condition` field that the doc omits entirely.

**Doc** (lines 431-447): Shows `TextPrompt` and `SelectPrompt` without `condition`.

**Actual** ([index.ts:70-71, 83-84, 100-101, 113-114](file:///Users/ryanho/Dev/opencode/packages/plugin/src/index.ts#L70-L71)):
```ts
/** @deprecated Use `when` instead */
condition?: (inputs: Record<string, string>) => boolean
```

Both `text` and `select` prompt types have a deprecated `condition` field alongside the documented `when` field. While it's deprecated, omitting it from the docs means plugin authors migrating old plugins won't understand what `condition` was.

---

### 7. Missing Event: `workspace.status`

> [!WARNING]
> The Event union in the SDK has **46 members**, but the doc claims "45 event types" and omits `workspace.status`.

**Missing event** ([types.gen.ts:517-524](file:///Users/ryanho/Dev/opencode/packages/sdk/js/src/v2/gen/types.gen.ts#L517-L524)):
```ts
export type EventWorkspaceStatus = {
  type: "workspace.status"
  properties: {
    workspaceID: string
    status: "connected" | "connecting" | "disconnected" | "error"
    error?: string
  }
}
```

This is a real event in the union but completely absent from the doc's event tables.

---

### 8. `ToolContext.metadata` — Signature Too Simplified

**Doc** (line 307):
```ts
metadata: (input) => void // Set title/metadata cho tool
```

**Actual** ([tool.ts:19](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tool.ts#L19)):
```ts
metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
```

The doc simplifies the input type. While not technically wrong, it hides the actual structure from the reader.

---

### 9. `Plugin` Type — Missing `options` Parameter

> [!IMPORTANT]
> The doc shows `Plugin` as a single-argument function, but the actual type accepts an optional second `options` parameter.

**Doc** (line 104):
```ts
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
```

**Actual** ([index.ts:42](file:///Users/ryanho/Dev/opencode/packages/plugin/src/index.ts#L42)):
```ts
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>
```

Where `PluginOptions = Record<string, unknown>`. The doc's example and signature in line 104 only shows the first `input` parameter.

---

### 10. `PluginModule` Type — Not Documented

The doc mentions `{ id?, server }` module style (line 65) but doesn't explicitly document the `PluginModule` type.

**Actual** ([index.ts:44-48](file:///Users/ryanho/Dev/opencode/packages/plugin/src/index.ts#L44-L48)):
```ts
export type PluginModule = {
  id?: string
  server: Plugin
  tui?: never
}
```

The `tui?: never` constraint is important for mutual exclusivity but isn't mentioned.

---

### 11. Doc TUI Config — Missing `PluginConfig` Reference

**Doc** (line 961):
> Fields bao gồm: `$schema`, `theme`, `keybinds`, `plugin`, `plugin_enabled`

**Actual** ([tui.ts:289-292](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L289-L292)):
```ts
type TuiConfigView = Pick<PluginConfig, "$schema" | "theme" | "keybinds" | "plugin"> &
  NonNullable<PluginConfig["tui"]> & {
    plugin_enabled?: Record<string, boolean>
  }
```

It also includes the spread of `NonNullable<PluginConfig["tui"]>` fields, which the doc doesn't enumerate.

---

## Minor Mismatches 🟢

### 12. TUI Plugin `OpencodeClient` Import Source

**Doc** (line 951):
```ts
api.client // OpencodeClient - runtime hiện tại
```

This is correct at the API level, but the doc doesn't clarify that the TUI uses `OpencodeClient` from `@opencode-ai/sdk/v2` (v2 API), not from `@opencode-ai/sdk`.

---

### 13. `TuiPluginModule` — `server?: never` Constraint

**Doc** (line 734):
```ts
const plugin: TuiPluginModule = {
  id: "my.plugin",
  tui,
}
```

**Actual** ([tui.ts:498-502](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tui.ts#L498-L502)):
```ts
export type TuiPluginModule = {
  id?: string
  tui: TuiPlugin
  server?: never
}
```

The `server?: never` constraint ensures mutual exclusivity with `PluginModule`, but the doc omits this.

---

### 14. `tool.schema` Export

**Doc** (line 287):
```ts
foo: tool.schema.string()
```

**Actual** ([tool.ts:37](file:///Users/ryanho/Dev/opencode/packages/plugin/src/tool.ts#L37)):
```ts
tool.schema = z
```

This is correct — `tool.schema` is just `zod`. The doc doesn't mention this, which could confuse plugin authors unfamiliar with `zod`.

---

### 15. `AuthOuathResult` Deprecated Alias

**Actual** ([index.ts:186-187](file:///Users/ryanho/Dev/opencode/packages/plugin/src/index.ts#L186-L187)):
```ts
/** @deprecated Use AuthOAuthResult instead. */
export type AuthOuathResult = AuthOAuthResult
```

The doc doesn't mention this deprecated alias. Minor, as it's deprecated and shouldn't be used.

---

## Verified Correct ✅

The following sections match the source correctly:

| Section | Status |
|---|---|
| `PluginInput` fields | ✅ All 6 fields match |
| `event` hook signature | ✅ Matches |
| `config` hook signature | ✅ Matches |
| `chat.message` hook | ✅ Matches |
| `chat.params` hook | ✅ Matches |
| `chat.headers` hook | ✅ Matches |
| `permission.ask` hook | ✅ Matches |
| `command.execute.before` hook | ✅ Matches |
| `tool.execute.before` hook | ✅ Matches |
| `tool.execute.after` hook | ✅ Matches |
| `tool.definition` hook | ✅ Matches |
| `shell.env` hook | ✅ Matches |
| `experimental.chat.messages.transform` | ✅ Matches |
| `experimental.chat.system.transform` | ✅ Matches |
| `experimental.session.compacting` | ✅ Matches |
| `experimental.text.complete` | ✅ Matches |
| `AuthHook` type | ✅ Matches (except deprecated `condition`) |
| `AuthOAuthResult` type | ✅ Matches |
| `ProviderHook` type | ✅ Matches |
| `ProviderHookContext` type | ✅ Matches |
| `Rule` type | ✅ Matches |
| `TuiCommand` type | ✅ Matches |
| `TuiRouteCurrent` type | ✅ Matches |
| `TuiDialogStack` API | ✅ Matches |
| `TuiKeybindSet` type | ✅ Matches |
| `TuiKV` type | ✅ Matches |
| `TuiState` (core fields) | ✅ Matches |
| `TuiTheme` API | ✅ Matches |
| `TuiThemeCurrent` tokens | ✅ All tokens match |
| `TuiApp` type | ✅ Matches |
| `TuiEventBus` type | ✅ Matches |
| `TuiLifecycle` type | ✅ Matches |
| `TuiPluginMeta` type | ✅ Matches |
| `TuiPluginStatus` type | ✅ Matches |
| `TuiSlotPlugin` / `slots.register` | ✅ Matches |
| `TuiHostSlotMap` all slot names & props | ✅ Matches |
| `plugins.*` API | ✅ Matches |
| All Events (except `workspace.status`) | ✅ 45/46 match |

---

## Summary

| Severity | Count | Items |
|---|---|---|
| 🔴 Critical | 5 | `ToolContext.ask` return type, missing `AskInput`, ghost `scopedClient`, ghost `api.state.workspace`, ghost `api.workspace` |
| 🟡 Moderate | 6 | Missing deprecated `condition`, missing `workspace.status` event, simplified `metadata`, missing `options` param, undocumented `PluginModule`, incomplete `TuiConfigView` |
| 🟢 Minor | 4 | SDK v2 import source, `server?: never` constraint, `tool.schema = z`, deprecated `AuthOuathResult` |
| **Total** | **15** | |
