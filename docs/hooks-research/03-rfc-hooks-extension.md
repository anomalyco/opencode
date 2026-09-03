# RFC-001: Hook System Extensions for OpenCode

> Status: **DRAFT**
> Author: analysis pipeline (Mar 2026)
> Tracking: implements HOOK-STOP-001, HOOK-SESSION-001/002, HOOK-MATCHER-001/002/003,
> HOOK-CONFIG-001 from `02-ears-requirements.md`.

## Summary

Extend the OpenCode hook system with three additions:

1. **New lifecycle events:** `stop`, `session.start`, `session.end`
2. **Config-driven matcher syntax** via `opencode.json`
3. **No breaking changes** to existing `Hooks` interface — purely additive

## Motivation

Analysis (`01-comparative-analysis.md`) identified three high-priority gaps
where OpenCode lags Claude Code:

| Gap | Impact |
|-----|--------|
| No `stop` hook | Users cannot reliably detect end-of-turn for cleanup/notification |
| No `SessionStart`/`SessionEnd` | Plugin lifecycle is asymmetric; init-before-cleanup missing |
| No matcher config | Every hook fires for every event; code-level filtering only |

These are **not architectural gaps** — the existing `plugin.trigger(name, input, output)`
machinery in `packages/opencode/src/session/prompt.ts` is sound. The
extension is **event surface area + configuration layer**, not core rewrites.

## Detailed design

### D1. New events in `Hooks` interface

In `packages/plugin/src/index.ts`, append to the `Hooks` interface:

```ts
export interface Hooks {
  // ... existing fields ...

  /**
   * Fires once at end of agent turn.
   * `reason` indicates completion status; `continue` allows plugin to
   * request another turn (advanced; default false).
   */
  stop?: (input: {
    sessionID: string
    agent: string
    messageID: string
    reason: "completed" | "aborted" | "error"
  }, output: { continue: boolean }) => Promise<void>

  /**
   * Fires once when session is created, before any tool calls.
   * Plugin may add to `metadata` (reserved keys blocked).
   */
  "session.start"?: (input: {
    sessionID: string
    cwd: string
    agent: string
    timestamp: number
  }, output: { metadata: Record<string, unknown> }) => Promise<void>

  /**
   * Fires once before session shutdown, before `dispose`.
   * `cleanup: false` defers forced cleanup for max 5s.
   */
  "session.end"?: (input: {
    sessionID: string
    duration_ms: number
    turn_count: number
    reason: "user_exit" | "error" | "timeout"
  }, output: { cleanup: boolean }) => Promise<void>
}
```

### D2. Trigger sites

Three new files modified; no new files at trigger sites.

**`packages/opencode/src/session/prompt.ts`** — emit `stop`:

After the existing `tool.execute.after` for TaskTool at line 390, wrap the
end-of-turn in a new helper:

```ts
async function emitStop(
  sessionID: string,
  agent: string,
  messageID: string,
  reason: "completed" | "aborted" | "error",
) {
  const output = { continue: false }
  await plugin.trigger("stop",
    { sessionID, agent, messageID, reason },
    output,
  )
  return output
}
```

Call sites:
- After turn completes naturally → `emitStop(..., "completed")`
- When `abort.signal` fires → `emitStop(..., "aborted")`
- When unrecoverable error in tool loop → `emitStop(..., "error")`

**`packages/opencode/src/session/session.ts`** (or equivalent) — emit
`session.start` and `session.end`:

```ts
// On session create
async function onSessionCreate(input: { sessionID, cwd, agent }) {
  const output = { metadata: {} }
  await plugin.trigger("session.start", { ...input, timestamp: Date.now() }, output)
  return output.metadata
}

// On session destroy (before existing dispose)
async function onSessionDestroy(input: { sessionID, turn_count }) {
  const output = { cleanup: true }
  await Promise.race([
    plugin.trigger("session.end", {
      ...input,
      duration_ms: Date.now() - session.started_at,
      reason: detectReason(),
    }, output),
    timeout(5000, "session.end timeout"),
  ])
  // dispose runs regardless of cleanup flag
}
```

### D3. Matcher config layer

New file: `packages/core/src/config/hook-matcher.ts`

```ts
export type Matcher =
  | string           // exact match (e.g. "bash")
  | RegExp           // compiled from /foo/i or /foo/
  | { glob: string } // future: glob patterns

export type HookConfigEntry = {
  matcher?: string | RegExp
  priority?: number  // default 100
  plugin: string     // path to plugin module
  options?: Record<string, unknown>
}

export type HooksConfig = {
  [eventName: string]: HookConfigEntry[]
}

export function parseMatcher(value: string | undefined): Matcher | null {
  if (value === undefined) return null
  if (value.startsWith("/") && value.endsWith("/")) {
    const body = value.slice(1, -1)
    try {
      return new RegExp(body)
    } catch {
      throw new ConfigError(`invalid regex matcher: ${value}`)
    }
  }
  return value
}

export function matches(matcher: Matcher | null, value: string): boolean {
  if (matcher === null) return true
  if (typeof matcher === "string") return matcher === value
  return matcher.test(value)
}
```

### D4. Integration with existing trigger

Modify `plugin.trigger` in `packages/opencode/src/plugin/index.ts`
(or wherever defined — to be located) to consult `hooks` config from
`opencode.json` and apply matchers BEFORE invoking each plugin hook.

**Key insight:** existing `Hooks` interface stays unchanged. The new
config-driven hooks are an **additional layer** on top. Plugins that
already implement hook fields continue to work; the config layer adds
**declarative** hooks that call into plugin modules.

### D5. Config schema

Add to `packages/core/src/config/schema.ts`:

```ts
const HookConfigEntry = z.object({
  matcher: z.string().optional(),
  priority: z.number().int().default(100),
  plugin: z.string(),
  options: z.record(z.unknown()).optional(),
})

export const HooksConfigSchema = z.record(z.array(HookConfigEntry))
```

## Alternatives considered

### A1. Replace `Hooks` interface with new declarative system

**Rejected.** Breaking change to existing plugins. Migration cost high
for marginal benefit. The two-system approach (code + config) is
additive.

### A2. Implement shell hooks now

**Deferred to RFC-002.** Requires defining cross-platform I/O contract
(JSON via stdin/stdout? binary protocol?). Worth doing but out of scope
for MVP. Adding shell hooks without the matcher layer means users have
to write shell scripts that re-implement filtering logic.

### A3. Single hook for all lifecycle events (`lifecycle` event with discriminator)

**Rejected.** Loses type safety. Matchers per event are more composable.

## Drawbacks

- **Two ways to define hooks:** code (existing) and config (new).
  Could confuse users. Mitigation: clear docs, default to config where
  possible, deprecate code-only for simple cases (future).
- **Config parsing surface area:** another schema to maintain.
  Mitigation: reuse existing `opencode.json` parsing infrastructure.

## Implementation plan

Phase 1 (1-2 weeks): events only, no matcher
- Add `stop`, `session.start`, `session.end` to `Hooks` interface
- Emit at correct trigger sites
- Goldens + property tests

Phase 2 (2-3 weeks): matcher config
- `parseMatcher` + `matches` utility
- Wire into `plugin.trigger`
- Schema for `opencode.json`
- Goldens + property tests + mutation tests

Phase 3 (1-2 weeks): docs + examples
- Update plugin docs with new events
- Provide example: safety hook for `bash` tool
- Provide example: cleanup hook on `session.end`

Total: 4-7 weeks. Aligns with §5 estimate in comparative analysis.

## Open questions

1. **Should `output.continue = true` in `stop` hook trigger a new turn?**
   Proposal: yes, but only if `reason === "completed"`. Documented as
   advanced usage. Default behavior unchanged.

2. **Where does `session.start` go in the existing
   `dispose`/`session.end` ordering?**
   Proposal: `session.start` is **before any tool call**. `session.end`
   is **before `dispose`**. Symmetric.

3. **Should matcher support glob patterns (`*.ts`)?**
   Proposal: yes, in Phase 2 if cheap to add; otherwise defer.

4. **What happens if `opencode.json` has invalid `hooks` config?**
   Proposal: fail closed at startup with clear error pointing to
   offending field. NOT silently ignore.

## Success criteria

This RFC is successful when:

- [ ] 3 new events fire at correct trigger sites (verified by tests)
- [ ] Matcher config works for string, regex, and empty cases
- [ ] No regression in existing plugin behavior
- [ ] Example plugin demonstrating each new event + matcher exists in
      `examples/hooks/`
- [ ] Docs updated in `docs/plugins.md` (or equivalent)
- [ ] All EARS requirements from `02-ears-requirements.md` pass

## Unresolved / future work

- Shell hook execution (RFC-002 candidate)
- HTTP/webhook hooks (RFC-003 candidate)
- Hook sandboxing for untrusted plugins
- Hook invocation telemetry (logs/metrics)
- Notification event (depends on shell hooks)
- SubagentStop dedicated event