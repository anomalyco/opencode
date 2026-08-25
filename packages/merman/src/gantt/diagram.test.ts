import { describe, expect, test } from "bun:test"
import { MermaidSyntaxError } from "../diagnostics.js"
import { expectDiagram } from "../test/diagram.js"
import { renderGanttDiagram } from "./diagram.js"
import { drawGanttDiagramGrid } from "./drawing.js"
import { isMermaidGanttDiagram, parseMermaidGanttDiagram } from "./parser.js"

const secondsDiagram = `gantt
  dateFormat s
  axisFormat %Ss
  section OLD (blocking)
  provider.create (Modal sandbox) :crit, 0, 15
  model streams first token :15, 17
  section NEW (eager kick)
  reserve (DB insert) :0, 1
  model streams first token :0, 2
  provisioning in background :active, 0, 15
  model calls bash → spawn runs :15, 16
  section NEW (pure chat thread)
  reserve (DB insert) :0, 1
  model answers, never calls bash :0, 4`

describe("GanttDiagram", () => {
  test("detects and parses second-based task ranges and states", () => {
    const diagram = parseMermaidGanttDiagram(secondsDiagram)

    expect(diagram.dateFormat).toBe("s")
    expect(diagram.axisFormat).toBe("%Ss")
    expect(diagram.tasks).toHaveLength(8)
    expect(diagram.tasks[0]).toMatchObject({
      label: "provider.create (Modal sandbox)",
      start: 0,
      end: 15_000,
      state: "critical",
    })
    expect(diagram.tasks[4]).toMatchObject({
      label: "provisioning in background",
      start: 0,
      end: 15_000,
      state: "active",
    })
  })

  test("renders sections, a formatted axis, and aligned task bars", () => {
    expectDiagram(renderGanttDiagram(secondsDiagram, { layoutMaxWidth: 100 })).toContainInOrder(
      "00s",
      "15s",
      "OLD (blocking)",
      "provider.create (Modal sandbox)",
      "model streams first token",
      "NEW (eager kick)",
      "provisioning in background",
      "NEW (pure chat thread)",
      "model answers, never calls bash",
    )
    expect(renderGanttDiagram(secondsDiagram)).toContain("\n\nNEW (eager kick)")
    expect(renderGanttDiagram(secondsDiagram)).not.toContain("·")
  })

  test("renders alternate terminal bar styles", () => {
    expect(renderGanttDiagram(secondsDiagram, { style: "block" })).toContain("█")
    expect(renderGanttDiagram(secondsDiagram, { style: "capsule" })).toContain("╶")
    expect(renderGanttDiagram(secondsDiagram, { style: "points" })).toContain("●")
    expect(renderGanttDiagram(secondsDiagram, { style: "track", track: "dots" })).toContain("·")
    expect(renderGanttDiagram(secondsDiagram, { style: "track", track: "line" })).not.toContain("·")
    expect(renderGanttDiagram(secondsDiagram, { style: "track", endpoints: "points" })).toContain("●")
    expect(renderGanttDiagram(secondsDiagram, { style: "track", line: "thin" })).toContain("─")
    expect(renderGanttDiagram(secondsDiagram, { style: "track", line: "double" })).toContain("═")
    expect(renderGanttDiagram(secondsDiagram, { style: "track", line: "dashed" })).toContain("╌")
    expect(renderGanttDiagram(secondsDiagram, { labels: "tree" })).toContain("├─ provider.create")
    expect(renderGanttDiagram(secondsDiagram, { labels: "tree" })).toContain("└─ model streams first token")
    expect(renderGanttDiagram(secondsDiagram, { sections: "spaced" })).toContain("\n\nNEW (eager kick)")

    const points = drawGanttDiagramGrid(parseMermaidGanttDiagram(secondsDiagram), {
      style: "track",
      endpoints: "points",
      trackTone: "faint",
    }).rows.flatMap((row) => row.filter((cell) => cell.char === "●"))
    expect(points.every((cell) => cell.style === "trackFaint")).toBe(true)
  })

  test("resolves task ids, after dependencies, durations, and milestones", () => {
    const diagram = parseMermaidGanttDiagram(`gantt
      dateFormat YYYY-MM-DD
      task one :done, first, 2026-08-01, 2d
      deploy :milestone, after first, 0d`)

    expect(diagram.tasks[1]).toMatchObject({
      start: Date.UTC(2026, 7, 3),
      end: Date.UTC(2026, 7, 3),
      state: "milestone",
    })
    expect(
      renderGanttDiagram(`gantt
      dateFormat YYYY-MM-DD
      task one :first, 2026-08-01, 2d
      deploy :milestone, after first, 0d`),
    ).toContain("◆")
  })

  test("rejects unsupported or ambiguous syntax with source diagnostics", () => {
    expect(() => parseMermaidGanttDiagram("gantt\n task :not-a-date, 2d")).toThrow(
      new MermaidSyntaxError(
        "gantt",
        2,
        "task :not-a-date, 2d",
        'Unsupported date "not-a-date" for dateFormat YYYY-MM-DD',
      ),
    )
    expect(() => parseMermaidGanttDiagram("gantt\n task :after missing, 2d")).toThrow('Unknown Gantt task id "missing"')
    expect(() => parseMermaidGanttDiagram("gantt\n excludes weekends")).toThrow(
      "excludes is not supported in gantt diagram",
    )
  })

  test("recognizes only Gantt headers", () => {
    expect(isMermaidGanttDiagram("%% comment\ngantt\n task :0, 1")).toBe(true)
    expect(isMermaidGanttDiagram("timeline\n 2026 : ship")).toBe(false)
  })

  test("renders partial diagrams containing only sections", () => {
    expect(renderGanttDiagram("gantt\n section Planning")).toBe("Planning")
  })
})
