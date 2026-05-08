# Tracker Detection and Defer Execution

This reference covers how Defer actions file tickets in the project's tracker. It is loaded by `SKILL.md` when Interactive mode's routing question needs to decide whether to offer option C (File tickets), when the walk-through's Defer option executes, and when the bulk-preview of option C is shown. It is also loaded by autonomous callers (e.g., `lfg`) that need to file residual actionable findings without user prompts — see Execution Modes below.

---

## Execution Modes

Tracker-defer has two execution modes. The caller selects one; the detection, fallback chain, and ticket composition are shared.

### Interactive mode (default)

Used by `ce-code-review` Interactive mode's routing question, walk-through Defer actions, and bulk-preview option C. All user-facing prompts fire:

- First Defer of the session with a generic (non-named) label confirms the effective tracker choice.
- Execution failures prompt with Retry / Fall back to next sink / Convert to Skip.
- Labels in the routing question reflect `named_sink_available` (name the tracker) vs fallback generics.

### Non-interactive mode

Used by autonomous callers like `lfg` that must not prompt. All blocking questions are skipped; the fallback chain is executed silently in order. Behavior:

- No confirmation on the first generic-label Defer; proceed directly.
- On execution failure, automatically fall to the next tier without prompting. Record the failure.
- On total chain exhaustion (every tier failed or no sink available), return findings in the `no_sink` bucket so the caller can route them to another surface (e.g., inline them in a PR description).
- Return a structured result: `{ filed: [{ finding_id, tracker, url }], failed: [{ finding_id, tracker, reason }], no_sink: [{ finding_id, title, severity, file, line }] }`.

The caller decides how to surface the result to the user. The non-interactive mode treats "no sink available" as a data-producing outcome, not a prompt trigger.

---

## Detection

The agent determines the project's tracker from whatever documentation is obvious. Primary sources: `CLAUDE.md` and `AGENTS.md` at the repo root and in relevant subdirectories. Supplementary signals (when primary documentation is ambiguous): `CONTRIBUTING.md`, `README.md`, PR templates under `.github/`, visible tracker URLs in the repo.

A tracker can be surfaced via MCP tool (e.g., a Linear MCP server), CLI (e.g., `gh`), or direct API. All are acceptable. The detection output is a tuple with two availability flags — one for the named tracker specifically (drives label confidence in Interactive mode) and one for the full fallback chain (drives whether Defer is offered at all):

```
{ tracker_name, confidence, named_sink_available, any_sink_available }
```

Where:
- `tracker_name` — human-readable name ("Linear", "GitHub Issues", "Jira"), or `null` when detection cannot identify a specific tracker
- `confidence` — `high` when the tracker is named explicitly in documentation (or via a linked URL to a specific project/workspace) and is unambiguously the project's canonical tracker; `low` when the signal is thin, conflicting, or implied only
- `named_sink_available` — `true` only when the agent can actually invoke the detected tracker (MCP tool is loaded, CLI is authenticated, or API credentials are in environment); `false` when the tracker is documented but no tool reaches it, or when no tracker is found at all. Drives label confidence: inline tracker naming requires this to be `true`.
- `any_sink_available` — `true` when any tier in the fallback chain (named tracker or GitHub Issues via `gh`) can be invoked this session. Drives whether Defer is offered in Interactive mode, and drives the `no_sink` bucket in Non-interactive mode.

Detection is reasoning-based. Do not maintain an enumerated checklist of files to read. Read the obvious sources and form a confident conclusion; when the obvious sources don't resolve, the label falls back to generic wording and the agent confirms with the user before executing (Interactive mode only).

---

## Probe timing and caching

Availability probes run **at most once per session** and **only when Defer execution is imminent**. Never speculatively at review start, never per-Defer, never per-walk-through-finding. The cached tuple is reused for every Defer action in the same run.

Typical probe sequence:

1. Read `CLAUDE.md` / `AGENTS.md` for tracker references. If nothing found, set `tracker_name = null`, `confidence = low`.
2. **Probe the named tracker when one was found.** For GitHub Issues, run `gh auth status` and `gh repo view --json hasIssuesEnabled`. For Linear or other MCP-backed trackers, verify the relevant MCP tool is loaded and responsive. For API-backed trackers, verify credentials in environment. Set `named_sink_available` from the probe result.
3. **Probe the GitHub Issues fallback to compute `any_sink_available`.** Even when the named tracker was found and probed, `gh` matters for the `no_sink` bucket decision so that a run with no documented tracker but working `gh` still offers Defer.
   - If `named_sink_available = true`: `any_sink_available = true` (no further probes needed).
   - Otherwise, probe GitHub Issues via `gh auth status` + `gh repo view --json hasIssuesEnabled` (skip if already probed in step 2). If it works, `any_sink_available = true`.
   - Otherwise, `any_sink_available = false`.

When Interactive mode's routing question is skipped entirely (R2 zero-findings case), no probes run. When the cached tuple is reused across a session, any `named_sink_available = true` from the session's first probe stays cached — do not re-probe per Defer.

---

## Label logic (Interactive mode)

- When `confidence = high` AND `named_sink_available = true`: the routing question's option C and the walk-through's per-finding Defer option both include the tracker name verbatim. Example: `File a Linear ticket per finding`, `Defer — file a Linear ticket`.
- When `any_sink_available = true` but either `confidence = low` or `named_sink_available = false` (a fallback tier is working instead): the labels read generically — `File an issue per finding`, `Defer — file a ticket`. Before executing the first Defer of the session, the agent confirms the effective tracker choice with the user using the platform's blocking question tool.
- When `any_sink_available = false`: option C is omitted from the routing question, option B (Defer) is omitted from the walk-through per-finding options, and the agent tells the user why in the routing question's stem.

Non-interactive mode skips label decisions entirely — it acts silently on the detected sink.

---

## Fallback chain

When the named tracker is unavailable or no tracker is named, fall back in this order. Prefer the project's detected tracker; use `gh` only when no named tracker was found or the named one is unreachable.

1. **Named tracker** (MCP tool, CLI, or API the agent can invoke directly, identified via Detection above)
2. **GitHub Issues via `gh`** — when `gh auth status` succeeds and the current repo has issues enabled (`gh repo view --json hasIssuesEnabled` returns `true`)
3. **No sink** — findings remain in the review report's residual-work section (Interactive mode) or are returned in the `no_sink` bucket for the caller to route (Non-interactive mode). The agent does not re-display them through a transient surface.

Previously this chain included a third in-session fallback tier. That tier was removed because in-session tasks do not survive past the session and therefore do not meet the "durable filing" intent of a Defer action. When no durable tracker exists, the correct behavior is to leave findings in the report (Interactive) or return them to the caller (Non-interactive).

---

## Ticket composition

Every Defer action creates a ticket with the following content, adapted to the tracker's capabilities:

- **Title:** the merged finding's `title` (schema-capped at 10 words).
- **Body:**
  - Plain-English problem statement — reads the persona-produced `why_it_matters` from the contributing reviewer's artifact file at `/tmp/compound-engineering/ce-code-review/<run-id>/{reviewer}.json`, using the same `file + line_bucket(line, +/-3) + normalize(title)` matching headless mode uses (see SKILL.md Stage 6 detail enrichment). Falls back to the merged finding's `title`, `severity`, `file`, and `suggested_fix` (when present) when no artifact match is available — these fields are guaranteed in the merge-tier compact return.
  - Suggested fix (when present in the finding's `suggested_fix`).
  - Evidence (direct quotes from the reviewer's artifact).
  - Metadata block: `Severity: <level>`, `Confidence: <score>`, `Reviewer(s): <list>`, `Finding ID: <fingerprint>`.
- **Labels** (when the tracker supports labels): severity tag (`P0`, `P1`, `P2`, `P3`) and, when the tracker convention supports it, a category label sourced from the reviewer name.
- **Length cap:** when the composed body would exceed a tracker's body length limit, truncate with `... (continued in ce-code-review run artifact: /tmp/compound-engineering/ce-code-review/<run-id>/)` and include the finding_id in both the truncated body and the metadata block so the artifact is discoverable.

The finding_id is a stable fingerprint composed as `normalize(file) + line_bucket(line, +/-3) + normalize(title)` — the same fingerprint used by the merge pipeline.

---

## Failure path

When ticket creation fails at execution (API error, auth expiry mid-session, rate limit, malformed body rejected, 4xx/5xx response):

**Interactive mode:** surface the failure inline and ask the user using the platform's blocking question tool.

Stem:
> Defer failed: <tracker name> returned <error summary>. How should the agent handle this finding?

Options:
- `Retry on <tracker>` — re-attempt the same tracker once more (useful for transient errors)
- `Fall back to next sink` — move this finding's Defer to the next tier in the fallback chain (e.g., from Linear to GitHub Issues)
- `Convert to Skip — record the failure` — abandon this Defer, note the failure in the completion report's failure section, and continue the walk-through or bulk flow

**Non-interactive mode:** do not prompt. Automatically fall through to the next tier. If every tier fails, record the finding in the `failed` bucket of the structured return and continue. If the chain exhausts with no sink ever available, the finding ends up in the `no_sink` bucket.

When a high-confidence named tracker fails at execution, the cached `named_sink_available` is set to `false` for the rest of the session. Subsequent Defer actions fall straight through to the next tier without retrying a confirmed-broken sink. `any_sink_available` is only downgraded to `false` when every tier has been confirmed broken — a failed Linear call that succeeds via `gh` keeps `any_sink_available = true`.

Only when `ToolSearch` explicitly returns no match or the tool call errors — or on a platform with no blocking question tool — fall back to numbered options and waiting for the user's reply (Interactive mode only).

---

## Per-tracker behavior

Concrete behavior per tracker at execution time. The agent may invoke any of these through the appropriate interface (MCP, CLI, or API) — the choice depends on what is available in the current environment.

| Tracker | Interface | Invocation sketch | Body format | Labels |
|---------|-----------|-------------------|-------------|--------|
| Linear | MCP (preferred) or API | Create issue in the project/workspace identified by documentation; assign to the reporter if the MCP tool exposes user context | Markdown | Severity priority field if the MCP exposes it; otherwise include severity in body |
| GitHub Issues | `gh issue create` | Repo defaults to the current repo. Use `--label` for severity tag when labels exist; omit `--label` if the repo has no label fixture. Fall back to a label-less issue on first failure. | Markdown | `--label P0` / `--label P1` / etc. when labels exist |
| Jira | MCP or API | Create issue in the project identified by documentation; Jira's markdown dialect differs from GitHub's — use plain text in the body when MCP does not handle conversion | Plain text when MCP does not handle markdown | Severity priority field |
| No sink available | — | Interactive: Defer option omitted, findings remain in the report's residual-work section. Non-interactive: findings returned in the `no_sink` bucket for caller routing. | — | — |

When uncertain, prefer "drop with explicit user-facing notice" over "pass through silently and hope." A Defer that produces no durable artifact and no user message is data loss.

---

## Cross-platform notes

The question-tool name varies by platform. In Interactive mode, use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code the tool should already be loaded from the Interactive-mode pre-load step — if it isn't, call `ToolSearch` with query `select:AskUserQuestion` now. Fall back to numbered options in chat only when the harness genuinely lacks a blocking tool — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it (e.g., Codex edit modes without `request_user_input`). A pending schema load is not a fallback trigger. Never silently skip the question.

Non-interactive mode is platform-agnostic: it never prompts, so the platform's question tool is not relevant.
