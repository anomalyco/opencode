---
name: ce-product-pulse
description: "Generate a time-windowed pulse report on what users experienced and how the product performed - usage, quality, errors, signals worth investigating. Use when the user says 'run a pulse', 'show me the pulse', 'how are we doing', 'weekly recap', 'launch-day check', or passes a time window like '24h' or '7d'. Configures via .compound-engineering/config.local.yaml and saves reports to docs/pulse-reports/."
argument-hint: "[lookback window, e.g. '24h', '7d', '1h'; default 24h]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
---

# Product Pulse

`ce-product-pulse` queries the product's data sources for a given time window and produces a compact, single-page report covering usage, performance, errors, and followups. The report is saved to `docs/pulse-reports/` and the key points are surfaced in chat.

The skill does not mutate the product, the database, or any external system. Its only writes are pulse settings appended to `.compound-engineering/config.local.yaml` (the unified CE local config, gitignored, machine-local) and the report file (`docs/pulse-reports/...`). MCP and other data-source tools are invoked read-only; if a tool offers write modes, do not use them.

## Interaction Method

Default to the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question.

Ask one question at a time. Reserve multi-select for first-run configuration only.

## Lookback Window

<lookback> #$ARGUMENTS </lookback>

Interpret the argument as a time window. Common forms:

- `24h`, `48h`, `72h` - trailing hours
- `7d`, `30d` - trailing days
- `1h` - short-window (useful during launches)

If the argument is empty, default to `pulse_lookback_default` from config (resolved in Phase 0); if that is also unset, fall through to the hard default of `24h`. If the argument is unparseable, ask the user to clarify.

Apply a **15-minute trailing buffer** to the window's upper bound. Many analytics and tracing tools have ingestion lag; querying right up to `now` under-reports the most recent events. For a `24h` window, query `[now - 24h - 15m, now - 15m]`.

## Core Principles

1. **Read it like a founder.** No hardcoded thresholds. Do not label things "bad" or "good" by default - present the numbers and let the reader judge.
2. **Single page.** Target 30-40 lines of terminal output. If the report is getting long, cut.
3. **No PII in saved reports.** Do not include user emails, account IDs, or message content in the report written to disk.
4. **Parallel where safe, serial where it matters.** Analytics and tracing queries run in parallel. Database queries run serially to avoid load.
5. **Memory through saved reports.** Every run writes to `docs/pulse-reports/` so past pulses are browseable as a timeline.
6. **Read-only database access only.** If a database is used as a data source, the connection must be read-only. The interview refuses to accept read-write credentials. Database access is optional - many products complete the pulse with analytics and tracing alone.
7. **Strategy-seeded when available.** If `STRATEGY.md` exists, the interview reads it before asking questions and carries forward the product name and key metrics as seeds. The goal of data-source setup is to wire up whatever connections are needed to actually measure those metrics.

## Execution Flow

### Phase 0: Route by Config State

**Config (pre-resolved):**
!`(top=$(git rev-parse --show-toplevel 2>/dev/null); [ -n "$top" ] && cat "$top/.compound-engineering/config.local.yaml" 2>/dev/null) || echo '__NO_CONFIG__'`

If the block above contains YAML key-value pairs, extract values for the `pulse_*` keys listed under "Config keys" below.
If it shows `__NO_CONFIG__`, the file does not exist — treat this as a first run.
If it shows an unresolved command string, read `.compound-engineering/config.local.yaml` from the repo root using the native file-read tool (e.g., Read in Claude Code, read_file in Codex). If the file does not exist, treat as first run.

**Config keys:**
- `pulse_product_name` -- string, used in report titles. Required for routing: if unset, skill is unconfigured.
- `pulse_lookback_default` -- one of `1h`, `24h`, `7d`, `30d` (default: `24h`)
- `pulse_primary_event` -- string, the engagement event name
- `pulse_value_event` -- string, the value-realization event name
- `pulse_completion_events` -- comma-separated string of 0-3 event names
- `pulse_quality_scoring` -- `true` or default `false` (AI products only)
- `pulse_quality_dimension` -- string scored 1-5 when `pulse_quality_scoring` is true; ignored otherwise
- `pulse_analytics_source` -- string identifying analytics provider (e.g., `posthog`, `mixpanel`, `custom`)
- `pulse_tracing_source` -- string identifying tracing provider (e.g., `sentry`, `datadog`, `custom`)
- `pulse_payments_source` -- string identifying payments provider (e.g., `stripe`, `custom`); omit if not used
- `pulse_db_enabled` -- `true` or default `false`; when `true`, read-only DB access is part of the pulse
- `pulse_metric_sources` -- comma-separated `metric=source` pairs giving per-strategy-metric source overrides (e.g., `retention_d7=posthog,nps=delighted`). Strategy metrics not listed fall back to `pulse_analytics_source` and are rendered with a `(default source)` marker so the implicit routing is visible.
- `pulse_pending_metrics` -- comma-separated string of strategy-doc metric names awaiting instrumentation; rendered as `no data` in each pulse report until instrumentation lands
- `pulse_excluded_metrics` -- comma-separated string of strategy-doc metric names intentionally excluded from the pulse; the metric stays in `STRATEGY.md` but is not surfaced in pulse reports

**Routing:**

- **`pulse_product_name` is unset (or config file missing)** -> First run. Go to Phase 1 (interview), then Phase 2.
- **`pulse_product_name` is set** -> Skip to Phase 2.

If the argument was `setup`, `reconfigure`, or `edit config`, go to Phase 1 regardless of config state.

### Phase 1: First-Run Interview

#### 1.0 Seed from strategy (if available)

Before asking any questions, read `STRATEGY.md` using the native file-read tool. If the file exists, extract:

- The product name from the `name` key in the YAML frontmatter, falling back to the H1 title (stripping the trailing ` Strategy` suffix, e.g., `# Spiral Strategy` -> `Spiral`) if frontmatter is missing
- The list of key metrics from the `## Key metrics` section, one per line

Open the interview by surfacing what was extracted: announce that a strategy doc was found, show the seeded product name and the list of key metrics that will be carried into event/data setup, and invite the user to correct any of it before continuing.

If `STRATEGY.md` does not exist, note that explicitly in chat: no strategy doc on file, running setup from scratch, and mention that `ce-strategy` can seed pulse later if run first.

#### 1.1 Interview

Read `references/interview.md`. This load is non-optional - the pushback rules, anti-pattern examples, and metric-to-source mapping logic live there.

Run the interview in this order:

1. Product name (confirm or edit the seeded value)
2. Primary engagement event
3. Value-realization event
4. Completions or conversions (0-3)
5. Quality scoring (opt-in, AI products only)
6. Data sources - wire up connections for each agreed metric and event. Nudge toward MCP. Reject read-write database access. DB entirely optional.
7. System performance - a short recommended setup for top errors and latency. Users rarely have strong opinions here; present defaults and accept.
8. Default lookback window

Apply the pushback rules in `references/interview.md` for each section. Treat every metric, event, and signal the user proposes against the **SMART bar** (specific, measurable, actionable, relevant, timely) spelled out in `references/interview.md` under "Overall Rules" - push back on anything vague, vanity, or unactionable.

If the user offers read-write database access, refuse and offer the alternatives documented in `references/interview.md` section 6.

Write the captured config to `<repo-root>/.compound-engineering/config.local.yaml` as flat `pulse_*` keys, using the schema in `references/interview.md` under "Config file shape". Resolve the repo root with `git rev-parse --show-toplevel`. To write: (1) if the file or directory does not exist, create `.compound-engineering/` and write the YAML file; (2) if the file exists, merge new keys into the existing YAML, preserving any non-pulse keys (e.g., `work_delegate_*`) untouched. If `.compound-engineering/config.local.yaml` is not already covered by the repo's `.gitignore`, offer to add the entry before writing. Show the resulting pulse block to the user in chat and offer one round of edits.

After the config is written, run the **scheduling recommendation** from `references/interview.md` section 9: offer to set up a recurring run so the user gets the pulse on a cadence instead of having to remember to run it. Accept yes/no/later. If yes, hand off to whichever scheduling primitive the current harness exposes — the in-plugin `schedule` skill if it is installed, otherwise note that scheduling is platform-specific (cron, GitHub Actions, the host's own automation) and emit a brief hint covering what would need to run. Do not schedule inline. Then proceed to Phase 2.

### Phase 2: Run the Pulse

If Phase 1 ran (first run, or `setup`/`reconfigure` argument), re-read `.compound-engineering/config.local.yaml` from the repo root using the native file-read tool to pick up any edits accepted during the Phase 1 review step. Otherwise, use the `pulse_*` values already extracted in Phase 0. Apply hard defaults for any unset settings (see Phase 0 "Config keys").

#### 2.1 Dispatch Queries

Run these in **parallel** (different tools, no shared load):

- Product analytics query (primary event count, value-realization count, completions, conversion ratios) over the window
- Application tracing query (error counts by category, latency distribution, top error signatures) over the window
- Payments query, if configured (new customers, churn, revenue delta) over the window

Run these **serially**, after the parallel batch:

- Read-only database queries. One at a time. Tight, scoped queries only. Never full-table scans on large tables. If a DB query would be expensive, skip it and note "DB query skipped (estimated cost too high)".

#### 2.2 Optional: Sample Quality Scoring

If `pulse_quality_scoring` is `true` (AI products only), sample up to 10 sessions or conversations from the window and score each 1-5 on the dimension recorded in `pulse_quality_dimension`.

**Scoring discipline:** Default to 4 or 5 when the session looks normal. Reserve 1-3 for sessions with a clear failure mode (product gave wrong answer, user got stuck, error surfaced). If every session is scoring 3, the bar is too strict; if every session is scoring 5, the bar is too loose.

**No PII in the score summary.** Capture a count distribution (e.g., "8x 5, 1x 4, 1x 2") and a short anonymized note on any session scored below 4. Do not include message content or user identifiers in the saved report.

#### 2.3 Assemble the Report

Read `references/report-template.md`. Fill in the template using the query results. Four sections, in order:

1. **Headlines** - 2-3 lines summarizing the window
2. **Usage** - primary engagement, value realization, completions, quality sample
3. **System performance** - latency (p50/p95/p99) and top 5 errors by count with one-line explanation each
4. **Followups** - 1-5 things worth investigating

Keep the total to 30-40 lines. If a section is thin, leave it thin; do not pad.

#### 2.4 Write the Report

Save to `docs/pulse-reports/YYYY-MM-DD_HH-MM.md` using the local time of the run. Create `docs/pulse-reports/` if it does not exist.

Surface the Headlines and top Followup in chat. Provide the full file path so the user can open the saved report.

### Phase 3: Routine Hook

First-run setup already offered scheduling (see Phase 1.1 end). Phase 3 is a lighter re-surface for ad-hoc runs:

- If the argument was a known schedule keyword (`daily`, `hourly`, `weekly`), note that this run is ad-hoc and suggest scheduling via the harness's available primitive (the in-plugin `schedule` skill where present; otherwise a platform-native option) for recurring runs.
- If no schedule is on file and this is the third or later pulse run the user has done, mention once that scheduling is available. Don't nag on every run.

Never schedule automatically. Any scheduling handoff requires explicit confirmation.

## What This Skill Does Not Do

- Does not report "what shipped." Shipped work lives in the issue tracker and commit history, not here. Pulse is strictly about user experience and system performance.
- Does not set thresholds or alert the user. The reader interprets.
- Does not persist PII in saved reports.
- Does not mutate the database or any external system. All queries are read-only.
- Does not replace tracing dashboards or analytics tools. It consolidates a single-page read; deep investigation still uses the native tools.

## Learn More

The "read like a founder" posture and the single-page constraint are deliberate. Dashboards with 40 metrics produce attention sprawl; one page with the right four sections forces the reader to notice what matters. The saved-reports folder is designed to be a team's working memory, not a data warehouse - past pulses are grepable, diffable, and disposable.
