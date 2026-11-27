# Diagram widget templates

Built-in canvas widget templates for showing data. Each one takes `title` and an optional `choose: true`, which adds a
Choose button that submits the selected element. Without `choose` they submit nothing: the user explores and you keep
talking. All animate in once, then redraw only when the user taps; colors follow the theme. Exact data schemas come
from `widget_template` action `list`; `packages/widget/test/fixtures/diagrams.ts` has an example for each.

| Widget template | Data | Use it for |
| --- | --- | --- |
| `pie` | `slices: { label, value }[]` (≤ 12), `donut?`, `unit?` | Parts of one whole (shares, budgets, traffic sources). Over 6 slices, prefer `chart` bars. |
| `scatter` | `series: { label, points: { x, y, size?, label? }[] }[]`, `xLabel?`, `yLabel?`, `trend?` | How two measures relate (size vs. time); `size` makes bubbles, `trend` adds least-squares lines. |
| `histogram` | `values: number[]` (raw, ≤ 2,000), `bins?`, `unit?`, `label?` | The distribution of one measure (latencies, scores); bins are picked automatically. |
| `area` | `series: { label, values }[]`, `labels?`, `mode?: "stacked" \| "percent" \| "stream"` | Totals and their composition over time (stacked), shares over time (percent), flowing themes (stream). |
| `heatmap` | `layout: "matrix"` with `rows`, `columns`, `values[row][column]`; or `layout: "calendar"` with `days: { date, value }[]` | Intensity across two categories (weekday × hour, correlation) or daily activity over months. |
| `treemap` | `items: { label, value?, children? }[]` (nested ≤ 4 levels), `rootLabel?` | What takes up the space in a hierarchy (disk usage, budget breakdown); the user drills in. |
| `sankey` | `nodes: { id, label? }[]`, `links: { source, target, value }[]` | Flows between stages where amounts split and merge (funnels with branches, energy, budget transfers). |
| `graph` | `nodes: { id, label?, group? }[]` (≤ 40), `edges: { source, target, label? }[]`, `directed?` | Networks without a hierarchy: dependencies, social links, knowledge graphs. Tap shows neighbors. |
| `tree` | `root: { label, note?, children? }` (≤ 6 levels), `orientation?: "right" \| "down"` | Hierarchies: org charts (`down`), file trees, taxonomies, decision breakdowns (`right`). Collapsible. |
| `timeline` | `tasks: { label, start, end?, group?, progress? }[]`, `today?` | Schedules and plans (Gantt): what runs when, overlaps, milestones (no `end`), progress. |
| `funnel` | `stages: { label, value }[]` (2–10) | Step-by-step drop-off in a process (visits → signups → paid) with conversion rates. |
| `radar` | `axes: string[]` (3–12), `series: { label, values }[]`, `max?` | Comparing a few items across several scored dimensions on one scale. |
| `gauge` | `gauges: { label, value, min?, max, unit?, target?, bands?: { to, tone }[] }[]` (1–4) | A few headline KPIs against thresholds (health, quotas, SLOs). |
| `boxplot` | `groups: { label, values? \| stats? }[]` (≤ 12) | Comparing distributions across groups (build times per runner) including spread and outliers. |
| `flowchart` | `nodes: { id, label?, shape? }[]` (process, decision, terminal, io), `edges: { from, to, label? }[]` | Processes and decision logic; laid out top down automatically, loops allowed. |
| `sequence` | `participants: string[]`, `messages: { from, to, label, kind? }[]` (sync, async, reply) | Interactions over time between systems or people (request flows, protocols). |
| `table` | `columns: { label, unit?, digits? }[]`, `rows: { cells, trend? }[]` (≤ 50) | Exact values the user wants to scan and sort, with a sparkline trend per row. |

For one or two plain series over categories or time, use `chart` (bar or line).
