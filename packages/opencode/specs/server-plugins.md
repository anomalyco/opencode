# Server plugins

Technical reference for server-side plugin hooks loaded from `opencode.json` and auto-discovered files under `.opencode/plugin/`.

## Overview

- Server plugin modules export a default async function `(input: PluginInput) => Hooks`.
- Types live in `@opencode-ai/plugin` (`packages/plugin/src/index.ts`).
- Auto-discovery scans `.opencode/plugin/` and `.opencode/plugins/` (see [Nested plugin directories](#nested-plugin-directories)).
- npm plugins resolve through `opencode.json` `plugin` entries; local file plugins can be listed explicitly or auto-discovered.

## Lifecycle: what exists (and what does not)

**There are no `session.start` or `session.end` plugin hooks.** If you need session lifecycle behavior, use the hooks below.

| Hook | When it runs | Typical use |
|------|--------------|-------------|
| `event` | Bus events (`session.created`, `session.updated`, `session.deleted`, …) | React to session lifecycle, cleanup resources |
| `tool.execute.before` | Before a tool runs; `output.args` is mutable | Rewrite bash commands, lazy-provision sandboxes |
| `tool.execute.after` | After a tool completes | Audit logging, annotate results |
| `chat.message` | Before a user message is processed | Inject context, approval keywords |
| `permission.ask` | Permission prompt | Auto-allow/deny patterns |
| `config` | Config loaded | Validate or extend config |
| `auth` / `provider` | Provider auth and model lists | Custom OAuth, provider extensions |

### Session lifecycle pattern

Use **`event`** for session boundaries:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export default (async () => ({
  event: async ({ event }) => {
    if (event.type === "session.created") {
      // optional: pre-warm resources (usually defer to first tool use)
    }
    if (event.type === "session.deleted") {
      // tear down sandboxes, flush audit buffers, etc.
    }
  },
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return
    // lazy provision on first bash, then rewrite output.args.command
  },
})) satisfies Plugin
```

**Anti-pattern:** waiting for `session.start` / `session.end` — those hooks are not part of the `Hooks` interface and will never be called by the runtime.

## Hook shapes (selected)

Import full types from `@opencode-ai/plugin`. Common shapes:

```typescript
// Bus events — includes session.created | session.updated | session.deleted
event?: (input: { event: Event }) => Promise<void>

// Mutable tool args before execution
"tool.execute.before"?: (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>

// Read-only tool result hook
"tool.execute.after"?: (
  input: { tool: string; sessionID: string; callID: string; args: any },
  output: { title: string; output: string; metadata: any },
) => Promise<void>
```

See `packages/plugin/src/index.ts` for the complete `Hooks` interface (chat hooks, compaction, custom tools, etc.).

## Nested plugin directories

Auto-discovery loads:

1. Top-level `.opencode/plugin/*.{js,ts}`
2. One- and two-level nested entrypoints: `.opencode/plugin/<name>/index.{js,ts}` and `.opencode/plugin/<a>/<b>/index.{js,ts}`

Helper modules inside plugin folders are not auto-loaded unless listed explicitly in `opencode.json`.

For a multi-file plugin, prefer a single `index.js` entrypoint in a subdirectory:

```text
.opencode/plugin/
  cloud-runner/
    index.js      ← auto-discovered
    sandbox.mjs   ← not auto-discovered (import from index.js)
```

Alternatively, copy a flat `my-plugin.js` into `.opencode/plugin/` or reference a path in `opencode.json`.

## Related docs

- TUI plugins: `packages/opencode/specs/tui-plugins.md`
- Hook type definitions: `packages/plugin/src/index.ts`
