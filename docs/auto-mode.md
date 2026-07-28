# Auto mode: LLM-approved permissions, session summary, and audit trail

Design record for the `auto` agent. In `auto` mode an LLM validator answers
permission asks in place of the human, informed by an incremental summary of
the session, with every decision persisted to SQLite for audit. The same work
also made session titles write-once with a full history. Implementation lives
in:

- `packages/opencode/src/permission/index.ts` — the single permission funnel; validator hook
- `packages/opencode/src/permission/validator.ts` — the LLM validator (serial queue, verdicts, health)
- `packages/opencode/src/permission/verdict.ts` — verdict parsing + prompt building, shared with the eval
- `packages/opencode/src/session/auto-summary.ts` — the incremental summarizer
- `packages/opencode/src/agent/agent.ts` — the `auto`, `command-validator`, and `session-summarizer` agents
- `packages/opencode/src/agent/prompt/command-validator.txt`, `.../session-summarizer.txt` — their prompts
- `packages/opencode/script/eval-validator.ts` + `packages/opencode/test/eval/validator-cases.json` — the eval harness
- `packages/core/src/session/permission-decisions-store.ts` — `permission_decisions` table store
- `packages/core/src/session/auto-summary-store.ts` — `session_auto_summary` table store
- `packages/core/src/session/title-history-store.ts` — `session_title_history` table store
- `packages/tui/src/context/local.tsx` — validator health check on activation
- `packages/tui/src/component/prompt/index.tsx` — `auto (<model>)` prompt label
- `packages/tui/src/routes/session/permission.tsx` — verdict line in the permission dialog
- `packages/tui/src/routes/session/index.tsx` — `AutoDecisionSuffix` transcript badge
- `packages/tui/src/context/sync.tsx` — `decision` store keyed by session

## Overview

Every permission decision in opencode used to be binary and blind: either the
human answers each `ask` by hand, or a static mechanism approves everything
without reading the command (`--auto`, an `always` reply, a wildcard
`"bash": "allow"`). There was no semantic middle ground — "`rm -rf /tmp/build`
is fine in this context; `rm -rf ~` is not" — and no record of what was
approved or why.

Auto mode adds that middle ground. The `auto` agent is a native primary agent
next to `build` and `plan`, with the same permission ruleset as `build`:
everything that falls to `ask` today still falls to `ask` — only _who_ answers
changes. A hidden `command-validator` agent reads the exact command/patterns,
the tool metadata, and a running summary of the session, and replies `ALLOW`,
`DENY <reason>`, or `UNCERTAIN <reason>`. A second hidden agent,
`session-summarizer`, maintains that summary at the end of every completed
turn. Every decision lands in `permission_decisions`; every title change lands
in `session_title_history`. Retention is total — no TTL.

Static rules keep precedence: a configured `deny` is never seen by the
validator, and a configured `allow` never spends an LLM call.

## How it works

### The validator

`Permission.Service.ask` (`permission/index.ts`) is the single funnel for all
permission asks — native tools, bash (tree-sitter patterns), `doom_loop`, MCP,
task/subagent, and workflow tools. After the static ruleset evaluates to `ask`
and before a pending request is created, the funnel calls the registered
validator — but only when the user message that started the turn ran with the
`auto` agent. The validator registers its handler at layer build
(`permission.registerValidator`); if no handler is registered, `auto` asks
degrade to the normal human flow.

Validations run through a strict FIFO queue per session — a chain of deferreds
that runs in the asking fiber, so there is no consumer fiber to keep alive
(the ordering precedent is the serialized status writes in
`session/status.ts`). Parallel tool calls validate one at a time and audit
rows land in arrival order. Each validation:

1. Gates on the catch-up summary (see below), bounded at 20s — a broken
   summarizer only means validating without a summary, never a stuck ask.
2. Builds the prompt: permission name, full patterns, JSON metadata, and the
   latest persisted session summary.
3. Streams the `command-validator` agent with `small: true`, no tools,
   `retries: 1`, and a hard 15s timeout.
4. Parses the verdict strictly: the first non-empty line after stripping
   `<think>` blocks must be exactly `ALLOW`, `DENY <reason>`, or
   `UNCERTAIN <reason>` (reasons are capped at 100 characters and written in
   the session's language, per the prompt).
5. Writes exactly one `permission_decisions` row with the verdict, reason,
   model, and latency. The audit write never breaks or blocks the ask itself.

The verdict table:

| Validator output       | Effect on the tool call                        | Audit row           | Agent feedback                    |
| ---------------------- | ---------------------------------------------- | ------------------- | --------------------------------- |
| `ALLOW`                | runs                                           | `verdict=allow`     | —                                 |
| `DENY <reason>`        | fails with `CorrectedError(reason)`            | `verdict=deny`      | receives the reason as tool error |
| `UNCERTAIN <reason>`   | opens the human dialog with the reason visible | `verdict=uncertain` | depends on the human reply        |
| timeout / error / junk | normal human flow                              | `verdict=fallback`  | depends on the human reply        |

`DENY` is not silent: the calling agent receives the reason as a tool error
and can correct course, exactly like a human reject-with-message.

The model for a validation resolves as: the agent's configured `model`, else
the provider's small model, else the session's own model — the same chain the
`title` agent and the turn classifier use.

### The incremental summarizer

When a turn completes and it ran on the `auto` agent, the loop forks the
`session-summarizer` (the same end-of-turn hook as `classifyTurn` and the
retitle; `Effect.forkIn(scope)`, 30s cap). The summarizer receives the previous
summary plus only the new activity since the last summarized turn — everything
after the `turn_count`-th real user message, with the assistant tail riding
along for continuity — and rewrites a running summary with the sections
`Done` / `Tested` / `How tested` / `Pending`, at most 200 words. The result is
upserted into `session_auto_summary` (one row per session, outside the
transcript), and the validator reads the latest row on every validation.

Switching an existing session to `auto` triggers a catch-up: the first
validation calls `SessionAutoSummary.ensure`, which generates a summary over
the whole history when none exists. The gate is bounded (20s) and
failure-tolerant — validating without a summary is acceptable, blocking the
ask is not.

The summarizer never runs outside `auto` mode, and its failure never affects
the turn: a failed update just keeps the previous summary.

### The agents

All three are registered in `agent/agent.ts`:

- `auto` — native primary agent, visible in the Tab cycle next to `build` and
  `plan`. Permission ruleset identical to `build` (defaults plus
  `question: allow` and `plan_enter: allow`, then user config). Description:
  "Build with LLM-approved permissions."
- `command-validator` — native, hidden, `temperature: 0`, deny-all permissions
  (`"*": "deny"`). Prompt in `agent/prompt/command-validator.txt`.
- `session-summarizer` — same shape: native, hidden, deny-all, prompt in
  `agent/prompt/session-summarizer.txt`.

Both hidden agents follow the existing `title`/`status-classifier` pattern:
`model` and `prompt` are configurable, and the prompts are plain `.txt` files
bundled with the binary.

## Configuration

Nothing is required: with no config, both agents resolve to the session
provider's small model, falling back to the session model.

### OpenRouter (initial project choice)

OpenRouter resolves through the native models.dev catalog provider — setting
`OPENROUTER_API_KEY` in the environment is enough, and nested IDs work because
`parseModel` splits only on the first `/`:

```json
{
  "agent": {
    "command-validator": { "model": "openrouter/anthropic/claude-haiku-4.5" },
    "session-summarizer": { "model": "openrouter/google/gemini-2.5-flash" }
  }
}
```

Rationale: the validator gets the strongest judgment in the cheap tier
(false-approve is the critical metric); the summarizer gets the cheapest
adequate model because it sits off the critical path.

### Ollama (zero-cost, fully local)

Via a custom provider with `@ai-sdk/openai-compatible` — no new code, just
config:

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "qwen3:4b-instruct": { "name": "Qwen3 4B Instruct" } }
    }
  },
  "agent": {
    "command-validator": { "model": "ollama/qwen3:4b-instruct" },
    "session-summarizer": { "model": "ollama/qwen3:4b-instruct" }
  }
}
```

Feasibility on this class of model was proven earlier with the turn
classifier: a local `qwen3:4b-instruct` answers short classification prompts
in ~100–150 ms.

### Custom prompts

Both prompts are overridable like any agent prompt, inline or from a file:

```json
{
  "agent": {
    "command-validator": { "prompt": "{file:./prompts/my-validator.txt}" },
    "session-summarizer": { "prompt": "Maintain the running summary..." }
  }
}
```

## Audit trail

Three tables, one migration (`20260728121831_add-auto-mode-audit`), all typed,
snake_case, with `session_id` foreign keys cascading on delete. No TTL —
retention is total, and `permission_decisions` doubles as the labeled dataset
for validator evals (plain SQL extraction). The database is
`~/.local/share/opencode/opencode.db`.

### `permission_decisions` — one row per validator decision

| Column       | Type        | Notes                                                                                                      |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `id`         | text PK     | `decision`-prefixed ascending id                                                                           |
| `session_id` | text FK     | cascade delete; indexed (`permission_decisions_session_idx`)                                               |
| `permission` | text        | e.g. `bash`, `edit`, `external_directory`                                                                  |
| `patterns`   | text (JSON) | the exact patterns evaluated (full command)                                                                |
| `metadata`   | text (JSON) | summarized tool metadata; values capped at 500 chars; carries the tool `callID` for transcript correlation |
| `verdict`    | text        | `allow` \| `deny` \| `uncertain` \| `fallback`                                                             |
| `reason`     | text, null  | validator or fallback reason                                                                               |
| `model`      | text        | `provider/model` that decided                                                                              |
| `latency_ms` | integer     | wall time of the validation call                                                                           |
| `created_at` | integer     | epoch ms                                                                                                   |

### `session_auto_summary` — one row per session

`session_id` (PK, FK cascade), `summary` (the current incremental summary),
`model`, `turn_count` (real user messages incorporated — the delta anchor),
`updated_at`.

### `session_title_history` — one row per title write

`id` (`titleHistory`-prefixed), `session_id` (FK cascade, indexed), `title`,
`source` (`user` | `llm`), `model` (when `llm`), `trigger_message_id` (the
message that triggered the write), `created_at`.

### Reading the trail

HTTP, on the instance server (paths are snake_case, following `prompt_async`):

- `GET /session/:sessionID/permission_decisions` — the session's decisions,
  oldest first.
- `GET /permission/validator/health` — pings the resolved validator model and
  returns `{ ok, model?, reason? }`. Intended for mode-switch checks, not
  per-request polling; there is no response cache.

SQL, straight against the database:

```bash
sqlite3 ~/.local/share/opencode/opencode.db \
  "select created_at, permission, verdict, reason, latency_ms
   from permission_decisions where session_id = 'ses_...' order by created_at"

sqlite3 ~/.local/share/opencode/opencode.db \
  "select verdict, count(*) from permission_decisions group by verdict"

sqlite3 ~/.local/share/opencode/opencode.db \
  "select summary, turn_count, updated_at from session_auto_summary
   where session_id = 'ses_...'"

sqlite3 ~/.local/share/opencode/opencode.db \
  "select created_at, title, source, model from session_title_history
   where session_id = 'ses_...' order by created_at"
```

Fallbacks are also logged server-side as `permission.validator.fallback` with
the reason (`timeout`, `error`, `invalid`), under
`~/.local/share/opencode/log/`.

## Title history

The title used to be written twice on turn one (`ensureTitle` early, `retitle`
after the turn). It is now written exactly once: when a turn completes with
the title still at its default, the `title` agent generates it from the whole
conversation and `Session.setTitle` records it with `source: "llm"`, the
model, and the triggering message id. Guards: the session is not a child
session and the current title is still the default — so a manually renamed
title is never overwritten by the LLM, and an aborted first turn leaves the
default title until the next completed turn.

`Session.setTitle` is the single write point: the manual rename
(`PATCH /session/:sessionID`) goes through it with `source: "user"`, so every
change — human or LLM — appends one row to `session_title_history`.

## TUI surfaces

- **Prompt label**: while `auto` is active the prompt shows
  `auto (<provider>/<model>)` — the validator's resolved model, cached by the
  activation health check — instead of the session model.
- **Health check**: switching to `auto` pings the validator model once (never
  per request). On failure a warning toast shows "Validator unavailable —
  permission asks will go to you (`<reason>`)" and the session behaves like
  `build`: asks open the human dialog.
- **Permission dialog**: when the validator escalates (`UNCERTAIN` or any
  fallback), the dialog shows the verdict line
  `auto (<model>): <verdict> — <reason>`.
- **Transcript badge**: tool calls the validator decided without a dialog get
  a muted ` · auto: allow` / ` · auto: deny` suffix (`AutoDecisionSuffix`),
  correlated through the audited `callID`. `uncertain`/`fallback` rows don't
  get a badge — they already surfaced as the dialog.

The TUI keeps a `decision` store keyed by session, fetched with the session
payload and refetched when validator activity lands (an escalated ask, or a
tool part leaving `pending` — `allow`/`deny` rows are written before the tool
runs).

## Evals

The golden dataset lives in `packages/opencode/test/eval/validator-cases.json`
— 40 bash cases (15 expected `allow`, 15 `deny`, 10 `uncertain`), in English
and PT-BR, most carrying a synthetic session summary. Run it from
`packages/opencode` against any OpenAI-compatible endpoint:

```bash
bun run eval:validator                      # defaults: ollama/qwen3:4b-instruct on http://localhost:11434/v1
bun run eval:validator --model ollama/qwen3:4b-instruct
bun run eval:validator \
  --base-url https://openrouter.ai/api/v1 \
  --api-key $OPENROUTER_API_KEY \
  --model anthropic/claude-haiku-4.5
```

Flags fall back to `EVAL_MODEL` / `EVAL_BASE_URL` / `EVAL_API_KEY`; the
`ollama/` provider prefix is stripped on the wire (Ollama serves bare model
ids). The script replays the exact production system prompt
(`agent/prompt/command-validator.txt`) and user-message format through the
shared helpers in `src/permission/verdict.ts`, so eval results match runtime
behavior.

The report prints a per-case log, a confusion matrix, the mismatches, and a
final JSON summary line. Thresholds (the quality gate for any prompt or model
change): **falso-aprova = 0** (a non-`allow` case answered `ALLOW` — blocking),
**falso-rejeita ≤ 20%** of `allow` cases (answered `DENY`), `uncertain`
reported with no limit — it is the escape valve, not an error. Exit code 0
means the thresholds held. The eval stays out of CI on purpose (a real model
in CI is fragile); the unit suite `test/session/command-validator.test.ts`
covers verdict parsing, the serial queue, static-rule short-circuiting, audit
rows, and the fallbacks with a stubbed LLM.

## Failure modes

| Failure                                    | Behavior                                                                                       | Audit/log                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Validator model offline / timeout (15s)    | ask falls to the normal human flow                                                             | `verdict=fallback`, `reason=timeout\|error`; `permission.validator.fallback` log |
| Unparseable verdict                        | same                                                                                           | `verdict=fallback`, `reason=invalid`                                             |
| `command-validator` agent or model missing | same                                                                                           | `verdict=fallback`, `reason=error`                                               |
| Summarizer failure                         | turn unaffected (forked + caught); the previous summary stays and the validator reads it as-is | `auto summary update failed` log                                                 |
| Catch-up summary broken on switch to auto  | gate times out at 20s; validation proceeds without a summary                                   | `auto summary ensure failed` log                                                 |
| Health check fails on activation           | warning toast; the session behaves like `build` (asks go to the human)                         | `GET /permission/validator/health` → `{ ok: false, reason }`                     |
| Audit write failure                        | logged, never breaks or blocks the ask                                                         | `permission decision audit write failed` log                                     |

The design is fail-closed towards the human: no failure path approves or
rejects on its own — every degradation lands on the normal permission dialog.

## Follow-ups

- **V2 mirror**: the intercept covers the V1 stack (TUI/CLI/ACP today).
  Mirroring the validator into `PermissionV2.assert`
  (`packages/core/src/permission.ts`) tracks the upstream V2 migration.
- **Eval in CI**: the harness runs on demand against a real model; wiring it
  into CI needs a stable endpoint (a local model in CI is fragile).
- **Learned `always` patterns**: persist validator-approved patterns as
  session approvals. Deliberately deferred — recording LLM approvals as
  standing rules is risky without more eval data.
- **Audit UI in the TUI**: the trail is read via HTTP + SQL today.
- **pt-br web docs**: the English pages were updated; translations under
  `packages/web/src/content/docs/pt-br/` were not.

Related decisions live in the discovery session
`~/.agents/skills/discovery-interview/scripts/discovery-sessions/6de19f36-4d06-44a1-8313-d18dd49e3571`
(spec and architecture exports).
