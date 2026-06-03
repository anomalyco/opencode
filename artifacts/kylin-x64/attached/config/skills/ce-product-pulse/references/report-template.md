# Pulse Report Template

Loaded by `SKILL.md` at Phase 2.3 after queries have returned. Fill the template using the query results. Target total length: 30-40 lines.

## Rules for filling in

- Use real numbers, not ranges or hedges. If a number is uncertain, note the source inline.
- Percent deltas compare the current window to the previous equal-length window (e.g., for `24h`, compare to the prior `24h`). If no comparison is possible, omit the delta rather than inventing one.
- No hardcoded thresholds. Do not label things "high" or "low" or color anything red unless the reader asked for threshold-based annotation at setup.
- No PII. No emails, no account IDs, no message content.
- Headlines are the top of the page. If a reader only reads the first 3 lines, they should know the most important thing that happened.
- If `STRATEGY.md` exists, re-read its `## Key metrics` section before assembling the report. For each strategy metric, decide what to render:
  - If the metric name appears in `pulse_excluded_metrics`, omit it from the report.
  - If the metric name appears in `pulse_pending_metrics`, include it in the Usage section marked `no data (instrumentation pending)`.
  - Otherwise, resolve the source for this metric: look it up in `pulse_metric_sources` (CSV of `metric=source` pairs); if present, use that source. If absent, fall back to `pulse_analytics_source` and append `(default source)` to the metric line so the implicit routing is visible. Then query and render the metric with its current value and delta. If the query returns no value, include it anyway and mark it `no data`.

## Template

The block below is the literal content to write. Replace every `{{placeholder}}` with query output. Delete lines whose data isn't available for this run.

~~~markdown
# {{product_name}} Pulse - {{window}} - {{YYYY-MM-DD HH:MM}} {{TZ}}

## Headlines

- {{one-line headline capturing the most notable thing in the window}}
- {{optional second headline}}
- {{optional third headline}}

## Usage

- **Primary engagement:** {{N events}} ({{delta vs prior window}})
- **Value realization:** {{N events}} ({{delta}}) - {{ratio vs engagement}}
- **Completions / conversions:**
  - {{conversion event 1}}: {{N}} ({{delta}})
  - {{conversion event 2}}: {{N}} ({{delta}})
- **Strategy metrics (if carried forward):**
  - {{metric name}}: {{value}} ({{delta}})
- **Quality sample (if configured):** {{distribution e.g. "8x 5, 1x 4, 1x 2"}}

## System performance

- **Latency:** p50 {{ms}}, p95 {{ms}}, p99 {{ms}} ({{delta vs prior window}})
- **Top errors** (top 5 by count, descending):
  1. **{{error signature}}** - {{N occurrences}} - {{one-line context, no PII}}
  2. **{{error signature}}** - {{N occurrences}} - {{one-line context}}
  3. **{{error signature}}** - {{N occurrences}} - {{one-line context}}
  4. **{{error signature}}** - {{N occurrences}} - {{one-line context}}
  5. **{{error signature}}** - {{N occurrences}} - {{one-line context}}

## Followups

- {{One thing worth investigating next - specific enough to act on}}
- {{Another thing worth investigating}}
- {{3-5 items max; trim if thin}}

---
_Source windows: analytics [{{start}} -> {{end}}], tracing [{{start}} -> {{end}}], payments [{{start}} -> {{end}}]. Trailing buffer: 15m. Saved to `docs/pulse-reports/{{YYYY-MM-DD}}_{{HH-MM}}.md`._
~~~

## Variations

- **No system performance tool configured:** omit the entire `## System performance` section. The report stays Headlines / Usage / Followups.
- **Quality scoring not opted in:** omit the quality sample line.
- **Single-source setup (analytics only):** omit the tracing and payments source windows from the footer.
- **Error count customized at setup** (e.g., top 3 instead of top 5): follow the configured count. Do not pad or trim beyond what the query returned.

## Post-write checklist

Before saving and surfacing to chat:

- [ ] Total length is 30-40 lines (give or take 5).
- [ ] Headlines exist and lead with the most notable item.
- [ ] No hardcoded thresholds ("high error rate", "low conversion").
- [ ] No PII. Scan error signatures and followups for user emails, IDs, or message snippets.
- [ ] Top 5 errors (or the configured count), not top 10. Trim if the query returned more.
- [ ] Strategy metrics carried forward from config are rendered in Usage, or marked `no data`.
- [ ] Followups are specific - each one should be actionable as a sentence.
- [ ] Filename and in-file timestamp use the same wall-clock time.

## What to surface in chat

After writing the file, post back:

- The Headlines section verbatim
- The top Followup, if action looks urgent
- The saved file path so the user can open the full report

Do not paste the full report into chat - the file is the artifact.
