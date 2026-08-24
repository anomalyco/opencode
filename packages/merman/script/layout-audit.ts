import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import {
  auditAllFixtures,
  summarizeAudits,
  worstAudits,
  type LayoutAudit,
  type LayoutMetrics,
} from "../src/test/layout-audit/harness.js"

const outputPath = resolve(import.meta.dir, "../../../tmp/merman-layout-audit.md")
const startedAt = performance.now()
const audits = auditAllFixtures()
const elapsedMs = performance.now() - startedAt
const summary = summarizeAudits(audits)

function label(audit: LayoutAudit): string {
  return `${audit.fixture.id} @${audit.viewport}`
}

function metricTable(items: readonly LayoutAudit[]): string {
  return [
    "| Fixture | Viewport | Size | Area | Route length | Bends | Crossings | Shared cells | Overflow |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map(
      (audit) =>
        `| \`${audit.fixture.id}\` | ${audit.viewport} | ${audit.metrics.width}x${audit.metrics.height} | ${audit.metrics.area} | ${audit.metrics.routeLength} | ${audit.metrics.bends} | ${audit.metrics.crossings} | ${audit.metrics.sharedRouteCells} | ${audit.metrics.overflow} |`,
    ),
  ].join("\n")
}

function worstSection(metric: keyof LayoutMetrics): string {
  const worst = worstAudits(audits, metric)
  return [`### ${metric}`, "", metricTable(worst)].join("\n")
}

function fixtureSection(audit: LayoutAudit): string {
  return [
    `<details${audit.fixture.curated || audit.violations.length > 0 ? " open" : ""}>`,
    `<summary><code>${label(audit)}</code> · ${audit.metrics.width}x${audit.metrics.height} · area ${audit.metrics.area} · bends ${audit.metrics.bends} · crossings ${audit.metrics.crossings} · overflow ${audit.metrics.overflow}</summary>`,
    "",
    ...(audit.violations.length > 0 ? ["Violations:", "", ...audit.violations.map((item) => `- ${item}`), ""] : []),
    "Source:",
    "",
    "```mermaid",
    audit.fixture.source,
    "```",
    "",
    "Rendered output:",
    "",
    "```text",
    audit.output,
    "```",
    "",
    "</details>",
  ].join("\n")
}

const grouped = Map.groupBy(audits, (audit) => `${audit.fixture.kind}/${audit.fixture.family}`)
const violations = audits.flatMap((audit) => audit.violations.map((violation) => `${label(audit)}: ${violation}`))
const markdown = [
  "# Merman Layout Audit",
  "",
  `Generated from ${new Set(audits.map((audit) => audit.fixture.id)).size} sources and ${audits.length} layout runs.`,
  "",
  `Structural violations: **${violations.length}**`,
  "",
  "## Aggregate Metrics",
  "",
  "```json",
  JSON.stringify(summary, null, 2),
  "```",
  "",
  "## Worst Offenders",
  "",
  ...(["area", "bends", "crossings", "sharedRouteCells", "overflow"] as const).flatMap((metric) => [
    worstSection(metric),
    "",
  ]),
  "## Fixtures",
  "",
  ...[...grouped.entries()].flatMap(([family, items]) => [
    `### ${family}`,
    "",
    metricTable(items),
    "",
    ...items.flatMap((audit) => [fixtureSection(audit), ""]),
  ]),
].join("\n")

await mkdir(dirname(outputPath), { recursive: true })
await Bun.write(outputPath, markdown)

console.log(`Wrote ${audits.length} layout runs to ${outputPath} in ${elapsedMs.toFixed(0)}ms`)
if (violations.length > 0) {
  console.error(violations.join("\n"))
  process.exitCode = 1
}
