# Feature contributions (fork `richarddaros/opencode`)

Index of the features built on the `sessions-command` branch (merged into
`fork/dev` via PR #1). Deep design records: [auto-mode.md](auto-mode.md) and
[sessions-status.md](sessions-status.md).

## 1. Cross-project sessions screen

Browse, search, and act on sessions across **all** projects, not just the
current one (`opencode sessions`).

- Sessions grouped by project path, with a footer anchored at the selected row.
- Delete sessions directly from the screen.
- Status icons per session (see §3).

```
opencode sessions        # open the cross-project sessions browser
```

## 2. New-session input with `@path` completion

Create a session for another directory without leaving the screen: type `@` to
get fuzzy directory completion anchored at the launch cwd, then confirm to
open a session in that path.

```
@projetos/richard-repositories/opencode<tab>   # fuzzy-matches directories
```

The last-used model and variant are carried into the new session, so you don't
re-pick them per directory.

## 3. Session status model (persisted)

Per-session status that survives restarts, shown as a gutter icon + footer
label with "cache heat" colors (hot <5min, warm 5–60min, cold >60min, aligned
with provider prompt-cache windows).

| Icon    | Label         | Meaning                                                    |
| ------- | ------------- | ---------------------------------------------------------- |
| spinner | `Working`     | a turn is running in a live process                        |
| `⚠`    | `Retrying`    | the provider call is being retried                         |
| `!`     | `Needs input` | a question/permission tool is blocked waiting for you      |
| `?`     | `Waiting`     | the turn completed with the assistant asking you something |
| `✓`     | `Done`        | the turn completed cleanly (expires after 30 min)          |
| `✕`     | `Interrupted` | the process behind an active status is gone                |

Internals: statuses persist to SQLite (`session_status`), writes are
serialized through a single queue, writers stamp their PID, and `Interrupted`
is derived from writer liveness — no false "interrupted" for sessions alive in
other terminals.

### LLM turn classification (experimental)

Replace the trailing-`?` heuristic with an LLM verdict:

```bash
OPENCODE_EXPERIMENTAL_STATUS_CLASSIFIER=1 opencode
```

```json
{
  "agent": {
    "status-classifier": { "model": "ollama/qwen3:4b-instruct" }
  }
}
```

## 4. Session titles: write-once + history + first-turn retitle

- The title is written exactly once: when the first turn completes with the
  title still at its default, the `title` agent generates it from the whole
  conversation.
- An aborted first turn keeps the default title; a manual rename is never
  overwritten.
- Every title write (LLM or manual) is recorded in `session_title_history`
  with its source.

## 5. Auto mode: LLM-approved permissions

A native `auto` primary agent (next to `build` and `plan`) where a hidden
`command-validator` agent answers permission asks semantically instead of the
human — "`rm -rf /tmp/build` is fine in this context; `rm -rf ~` is not".

```
┌ Permission ──────────────────────────┐
│ Bash: rm -rf ~/  ──────────────────  │
│ validator: DENY "deletes home dir"   │
└──────────────────────────────────────┘
```

- Verdicts: `ALLOW` (runs), `DENY <reason>` (the agent gets the reason as a
  tool error and can correct course), `UNCERTAIN <reason>` (opens the human
  dialog with the reason visible); timeout/error/junk degrades to the human
  flow.
- The prompt is fenced with per-call nonces against prompt injection;
  truncated payloads never approve.
- Every decision lands in the `permission_decisions` audit table (verdict,
  reason, model, latency, and the exact prompt sent to the validator) — no
  TTL, and an `ALLOW` whose audit row fails to land degrades to the human
  flow instead of executing without evidence.
- Static rules keep precedence: configured `deny` never reaches the validator;
  configured `allow` never spends an LLM call.

The TUI surfaces validator state: `auto (<model>)` prompt label, verdict line
in the permission dialog, an `Auto` decision badge on approved tool calls in
the transcript, an `Auto` sidebar section with the current session summary
and the decision list, and a `/decisions` dialog whose detail view shows
every audited field including the full validator prompt.

### Eval harness

Golden-dataset eval for the validator, gated on errors and invalid verdicts:

```bash
bun script/eval-validator.ts   # packages/opencode
```

Cases live in `packages/opencode/test/eval/validator-cases.json`.

## 6. Incremental session summaries

A hidden `session-summarizer` agent rewrites a running summary at the end of
every completed turn in `auto` sessions, receiving only the new activity since
the last summarized turn. The validator consumes the latest persisted summary
as context, with a 20s catch-up bound — a broken summarizer means validating
without a summary, never a stuck ask.

## Commit map

| Feature                        | Commits (main)                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Sessions screen                | `cdc1ccb52e` `2ee34fd357` `e75392605b` `945ed236da` `547b8035ac` `d880a1fa58`              |
| Status model + icons           | `e87a0a60fb` `c2f3ed5a38` `2df314cf66` `bbbcd4e1bf` `aa31c72299` `c8877c2f08` `8fd47742b7` |
| Model carry-over               | `3917e3e576`                                                                               |
| Titles: classifier + retitle   | `7d39c5b866` `e73529c87c` `299f287e5d`                                                     |
| Auto mode + validator + audit  | `2ac73c27cd` `8f6cb8ac70` `26caf3fb8d` `13e8470a5c` `cecf5abd10` `df188f9939`              |
| Hardening (injection, timeout) | `f02116c890` `1594e03836` `a72b5c66da`                                                     |
| Eval + docs                    | `e2450a28c0` `d332af1a25` `a701c9ba6e` `066ca096ac` `3a3ad3e6d6` `a693c37f68`              |
