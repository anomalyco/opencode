import { describe, expect, test } from "bun:test"
import { renderTimelineDiagram } from "./diagram.js"
import { drawTimelineDiagramGrid } from "./drawing.js"
import { parseMermaidTimelineDiagram } from "./parser.js"
import { renderTimelineGridText } from "./render-grid.js"
import { resolveTimelineStyleColors } from "./style.js"

describe("TimelineDiagram", () => {
  test("detects and parses titles, sections, periods, inline events, and continuations", () => {
    const diagram = parseMermaidTimelineDiagram(`
%% product history
timeline LR
  title Product &amp;<br/>Platform

  section Foundation
  2024 : Prototype : First release
       : Public beta
  section Growth
  2025 : "Scale: &#x2265; 10k"
`)

    expect(diagram.direction).toBe("LR")
    expect(diagram.title).toBe("Product &<br/>Platform")
    expect(diagram.sections).toEqual([{ label: "Foundation" }, { label: "Growth" }])
    expect(diagram.periods).toEqual([
      { period: "2024", events: ["Prototype", "First release", "Public beta"] },
      { period: "2025", events: ["Scale: ≥ 10k"] },
    ])
    expect(diagram.entries.map((entry) => entry.type)).toEqual(["section", "period", "section", "period"])
  })

  test("renders a vertical spine with title, section, periods, events, entities, and line breaks", () => {
    const output = renderTimelineDiagram(`timeline
  title Product &amp;<br/>Platform
  section Foundation<br/>phase
  2024 : Prototype<br/>ready : First release
       : Scale &#x2265; 10k`)

    expect(output).toBe(
      [
        "           Product &",
        "           Platform",
        "",
        "Foundation ───┐",
        "     phase    │",
        "              │",
        "      2024 ───●  Prototype",
        "              │  ready",
        "              │  First release",
        "              │  Scale ≥ 10k",
        "              │",
      ].join("\n"),
    )
  })

  test.each(["timeline", "timeline TD", "timeline LR"])("uses the vertical terminal layout for %s", (header) => {
    const output = renderTimelineDiagram(`${header}\n  2024 : One\n  2025 : Two`)
    const lines = output.split("\n")

    expect(lines.findIndex((line) => line.includes("2024"))).toBeLessThan(
      lines.findIndex((line) => line.includes("2025")),
    )
    expect(output).toContain("│")
    expect(output).toContain("●")
  })

  test("preserves Mermaid direction semantics while using vertical terminal layout", () => {
    expect(parseMermaidTimelineDiagram("timeline\n  2024 : One").direction).toBe("LR")
    expect(parseMermaidTimelineDiagram("timeline TD\n  2024 : One").direction).toBe("TD")
  })

  test("keeps ordinary colons in event text", () => {
    const diagram = parseMermaidTimelineDiagram(`timeline
  2024 : https://example.com : event:detail : next event`)

    expect(diagram.periods[0]?.events).toEqual(["https://example.com", "event:detail", "next event"])
  })

  test("does not treat apostrophes in event prose as quotes", () => {
    const diagram = parseMermaidTimelineDiagram("timeline\n  2024 : Kit's launch : Public beta")

    expect(diagram.periods[0]?.events).toEqual(["Kit's launch", "Public beta"])
  })

  test("supports standalone periods followed by continuation events", () => {
    const diagram = parseMermaidTimelineDiagram(`timeline
  2024
  : First release
  : Public beta`)

    expect(diagram.periods).toEqual([{ period: "2024", events: ["First release", "Public beta"] }])
  })

  test("ignores timeline comments and accessibility directives", () => {
    const diagram = parseMermaidTimelineDiagram(`timeline
  # product history
  accTitle: Product timeline
  accDescr Product release history
  2024 : Prototype %% internal note`)

    expect(diagram.periods).toEqual([{ period: "2024", events: ["Prototype"] }])
  })

  test("ignores multiline accessibility descriptions", () => {
    const diagram = parseMermaidTimelineDiagram(`timeline
  accDescr {
    Product milestones by year.
    Includes launch and growth.
  }
  2024 : Ship`)

    expect(diagram.periods).toEqual([{ period: "2024", events: ["Ship"] }])
  })

  test("rejects a continuation without a period with source diagnostics", () => {
    expect(() => parseMermaidTimelineDiagram("timeline\n  : orphan event")).toThrow(
      'Timeline continuation requires a preceding period in timeline diagram at line 2: ": orphan event"',
    )
  })

  test("rejects unsupported and empty syntax", () => {
    expect(() => parseMermaidTimelineDiagram("timeline\n  section")).toThrow("Timeline section cannot be empty")
    expect(() => parseMermaidTimelineDiagram("timeline\n  2024 :")).toThrow("Timeline event cannot be empty")
    expect(() => parseMermaidTimelineDiagram("timeline\n  : unsupported")).toThrow("requires a preceding period")
  })

  test("draws semantic styles for every timeline role", () => {
    const grid = drawTimelineDiagramGrid(
      parseMermaidTimelineDiagram("timeline\n title Roadmap\n section Now\n 2026 : Ship"),
    )
    const styles = new Set(grid.rows.flatMap((row) => row.map((cell) => cell.style).filter(Boolean)))

    expect(styles).toEqual(
      new Set([
        "title",
        "section",
        "sectionFade1",
        "sectionFade2",
        "sectionFade3",
        "spine",
        "period",
        "periodFade1",
        "periodFade2",
        "periodFade3",
        "event",
      ]),
    )
    expect(Object.keys(resolveTimelineStyleColors()).sort()).toEqual([
      "event",
      "period",
      "periodFade1",
      "periodFade2",
      "periodFade3",
      "section",
      "sectionFade1",
      "sectionFade2",
      "sectionFade3",
      "spine",
      "title",
    ])
    expect(renderTimelineGridText(grid)).toBe(
      renderTimelineDiagram("timeline\n title Roadmap\n section Now\n 2026 : Ship"),
    )
  })

  test("uses section starts and joins with ordered color ramps", () => {
    const grid = drawTimelineDiagramGrid(
      parseMermaidTimelineDiagram("timeline\n section Morning\n 09:00 : Start\n section Midday\n 12:00 : Continue"),
    )
    const text = renderTimelineGridText(grid)

    expect(text).toContain("Morning ───┐")
    expect(text).toContain("Midday ───┤")
    expect(grid.rows[0]?.map((cell) => cell.style).filter(Boolean)).toEqual([
      "section",
      "section",
      "section",
      "section",
      "section",
      "section",
      "section",
      "sectionFade1",
      "sectionFade2",
      "sectionFade3",
      "spine",
    ])
  })
})
