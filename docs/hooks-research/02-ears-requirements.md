# EARS Requirements: Hook System Extensions for OpenCode

> Requirements formais (EARS-style) para os gaps de hooks identificados em
> `01-comparative-analysis.md`. Cada requisito é verificável, atômico e
> referenciável. Baseado em código real do fork `anomalyco/opencode`.

## Escopo

Esta spec cobre **apenas os gaps de prioridade Alta**:

- HOOK-STOP-001: Stop hook event
- HOOK-SESSION-001/002: SessionStart e SessionEnd
- HOOK-MATCHER-001/002/003: Matcher syntax config-driven

Os gaps de prioridade Média/Baixa (Notification, SubagentStop dedicado,
shell hooks nativos, telemetry) ficam para RFCs futuros.

## Convenções EARS

Padrões usados:
- **Ubiquitous:** "The system shall..."
- **Event-driven:** "When <trigger>, the system shall..."
- **State-driven:** "While <state>, the system shall..."
- **Unwanted behavior:** "If <condition>, the system shall..."
- **Optional:** "Where <feature>, the system shall..."

Identificador: `HOOK-<CATEGORY>-<NUMBER>`

---

## HOOK-STOP-001: Stop event fires at end of agent turn

**Statement:** When the agent completes a turn (no more tool calls pending and
no additional LLM iteration scheduled), the OpenCode runtime shall fire a
`"stop"` hook for all loaded plugins with input
`{ sessionID: string, agent: string, messageID: string, reason: "completed" | "aborted" | "error" }`
and output `{ continue: boolean }`.

**Rationale:** Claude Code defines `Stop` hook for this case. OpenCode
currently has no equivalent; users must heuristically infer end-of-turn
from `tool.execute.after`. Without this, plugins cannot reliably clean up
state, notify external systems, or trigger post-turn workflows.

**Verification:**
- Goldens (input/output fixtures) defined in `packages/opencode/test/hook-stop.test.ts`
- Property test: for any session with at least one completed turn, exactly
  one `stop` hook fires per turn (never zero, never two).
- Failure injection: simulate tool execution failure; verify `reason: "error"`
  path fires exactly once.
- Mutation test: remove `stop` invocation from
  `packages/opencode/src/session/prompt.ts`; suite must catch it.

**Negative cases:**
- If `reason: "error"` and the plugin sets `output.continue = true`, the
  runtime shall NOT retry the turn — the error stands.
- If `reason: "aborted"` (user interrupted via Ctrl-C), the runtime shall
  NOT call `stop` more than once even if the plugin throws.

---

## HOOK-SESSION-001: SessionStart fires once per session

**Statement:** When a session is created (via API call or CLI invocation),
the OpenCode runtime shall fire a `"session.start"` hook for all loaded
plugins with input `{ sessionID: string, cwd: string, agent: string, timestamp: number }`
and output `{ metadata: Record<string, unknown> }`.

**Rationale:** Claude Code defines `SessionStart` for plugin authors to
initialize state, set up databases, register background workers.
OpenCode only has `dispose` (end-of-life) — asymmetric.

**Verification:**
- Goldens: input contract matches schema above
- Property test: for any N sessions created, exactly N `session.start`
  events fire (no duplicates, no drops)
- Concurrency test: create 100 sessions in parallel; verify each fires
  its own `session.start` with correct `sessionID`

**Negative cases:**
- If a plugin throws during `session.start`, the session shall still be
  created. The throw shall be logged but not propagate.
- If `output.metadata` contains keys that conflict with reserved session
  metadata keys (`sessionID`, `cwd`, `agent`, `timestamp`), the runtime
  shall reject the modification with `Error("reserved metadata key")`.

---

## HOOK-SESSION-002: SessionEnd fires before dispose

**Statement:** While a session is shutting down, the OpenCode runtime shall
fire a `"session.end"` hook for all loaded plugins with input
`{ sessionID: string, duration_ms: number, turn_count: number, reason: "user_exit" | "error" | "timeout" }`
and output `{ cleanup: boolean }`. After all `session.end` hooks resolve,
the runtime shall call the existing `dispose` lifecycle.

**Rationale:** Claude Code distinguishes `SessionEnd` (about to clean up)
from internal dispose. Plugins need the signal BEFORE state is destroyed
to commit pending work.

**Verification:**
- Goldens verify the order: `session.end` → plugin code can still access
  session storage → then `dispose` fires
- Property test: for any session that ends normally, exactly one
  `session.end` fires
- Integration test: plugin writes a file in `session.end`; assert file
  exists after dispose

**Negative cases:**
- If a plugin sets `output.cleanup = false`, the runtime shall force
  cleanup anyway after a 5-second timeout (hard ceiling, no opt-out).
- If `reason: "error"`, the runtime shall NOT block shutdown waiting
  for slow hooks; bail-out after 2-second timeout with warning logged.

---

## HOOK-MATCHER-001: Matcher field in hook config

**Statement:** Where a plugin defines a hook in `opencode.json` via the
`"hooks"` section, the runtime shall parse a `"matcher"` field per hook
entry as either a string (exact tool name) or a regex pattern
(`/regex/` syntax) and apply the hook only when the runtime event matches.

**Rationale:** Today every hook fires for every tool call. Plugin authors
must write `if (input.tool === "bash") { ... }` in code. A config-driven
matcher is more discoverable, auditable, and reusable.

**Verification:**
- Property test: for any matcher string and any tool name, the matcher
  function returns true iff tool name equals matcher (case-sensitive,
  exact match).
- Property test: for any regex matcher `/foo|bar/` and tool name, the
  matcher returns true iff regex matches.
- Negative: empty matcher `""` shall match nothing.
- Negative: malformed regex `/[invalid/` shall fail closed with config
  validation error at startup, NOT at hook-fire time.

**Negative cases:**
- If matcher is a plain string that contains regex metacharacters
  (e.g. `bash.execute`), it shall be treated as a literal string, NOT
  as a regex. Only `/.../` syntax opts into regex.

---

## HOOK-MATCHER-002: Matcher applies to event-specific input

**Statement:** When a matcher is configured for an event, the runtime
shall match against the event-specific field:

| Event | Field matched |
|-------|---------------|
| `tool.execute.before` / `tool.execute.after` | `input.tool` |
| `command.execute.before` | `input.command` |
| `chat.message` | `input.sessionID` (no matcher, all sessions) |
| `permission.ask` | `input.action` |
| `stop` | `input.reason` |
| `session.start` / `session.end` | (no matcher; fires once) |

**Rationale:** Different events have different discriminators. A matcher
on `tool.execute.before` matching tool name is natural; on `chat.message`
it would match session ID, which is rarely what users want.

**Verification:**
- Goldens per event type with both matching and non-matching input.
- Negative: matcher on `session.start` shall be silently ignored
  (matcher never blocks lifecycle events).

---

## HOOK-MATCHER-003: Multiple hooks ordered by priority field

**Statement:** Where multiple hooks match a single event, the runtime
shall execute them in ascending order of a `"priority"` field
(integer, default 100) with ties broken by plugin load order.

**Rationale:** Today plugins execute in undefined order. With multiple
hooks (e.g., safety check before audit logger), explicit ordering
matters. Priority 100 default keeps existing behavior compatible.

**Verification:**
- Property test: for any 3 hooks with priorities [50, 100, 200], the
  runtime calls them in order [50, 100, 200].
- Tie-break test: 2 hooks with priority 100 → order is load order.
- Mutation test: reverse sort order; suite catches.

**Negative cases:**
- Negative priority values are allowed (use case: "first" hook that
  runs before all defaults).
- If priority is not an integer, runtime shall reject config at startup.

---

## HOOK-CONFIG-001: Hook config schema in opencode.json

**Statement:** Where the user provides a `"hooks"` section in
`opencode.json`, the schema shall be:

```json
{
  "hooks": {
    "<event-name>": [
      {
        "matcher": "Bash|Edit",
        "priority": 100,
        "plugin": "./plugins/my-plugin.ts",
        "options": { "strict": true }
      }
    ]
  }
}
```

The runtime shall validate the config at startup. Invalid configs
shall cause startup to fail with a clear error message identifying
the offending field.

**Rationale:** Config-driven hooks (vs plugin-code-only) is the
Claude Code model. Allows non-TS users to configure hooks by pointing
to a plugin file path.

**Verification:**
- JSON schema test: every example in this spec parses without error.
- Negative: unknown event name → startup fails with `Error("unknown hook event: <name>")`.
- Negative: matcher not a string or `/.../` → startup fails.
- Negative: priority not an integer → startup fails.

---

## Traceability

| REQ | Source analysis section | Verified by |
|-----|------------------------|-------------|
| HOOK-STOP-001 | §3.1 Stop hook | goldens + property test |
| HOOK-SESSION-001 | §3.2 SessionStart | goldens + concurrency test |
| HOOK-SESSION-002 | §3.2 SessionEnd | goldens + integration test |
| HOOK-MATCHER-001 | §3.3 Matcher syntax | property test |
| HOOK-MATCHER-002 | §3.3 (event-specific) | goldens per event |
| HOOK-MATCHER-003 | §3.3 (ordering) | property test |
| HOOK-CONFIG-001 | §5 config schema | JSON schema test |

## Out of scope

Not addressed here (covered in future specs if prioritized):
- Shell-based hooks (external command execution)
- HTTP/webhook hooks
- Notification event
- SubagentStop dedicated event
- Hook telemetry/logging
- Hook sandboxing/permissions for untrusted hooks

## Risks identificados

- **Performance:** matcher evaluation on every hook fire adds overhead.
  Mitigation: cache compiled regex; benchmark overhead, budget ≤ 50μs per fire.
- **Config bloat:** if users define many matchers, config file grows.
  Mitigation: support glob patterns as third matcher form (`*.ts`).
- **Backward compat:** new events must not break existing plugins that
  only implement a subset of `Hooks` interface. All new fields are optional.