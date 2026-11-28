import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { labTool } from "../lab/current-session-scenarios"
import { timelinePresets, type TimelineDetail } from "./detail"
import { placeFactOf, type PlaceFact } from "./facts"
import { place, placeContent, placeNotice, placer } from "./place"

const preset = (id: string) => timelinePresets.find((item) => item.id === id)!.value

const custom = (overrides: Partial<TimelineDetail>): TimelineDetail => ({ ...preset("detailed"), ...overrides })

const call = (overrides: Partial<PlaceFact>): PlaceFact => ({
  ...placeFactOf(labTool("c", "custom", "completed", {})),
  ...overrides,
})

describe("place", () => {
  test("places by index, so facts sharing an id each keep their own commentary", () => {
    const placed = place(
      [
        { kind: "text", id: "a" },
        { kind: "text", id: "a" },
      ],
      custom({ commentary: { placement: "grouped" } }),
      {
        timeline: "next",
        commentary: [true, false],
      },
    )

    expect(placed.map((item) => [item.category, item.group])).toEqual([
      ["commentary", "context"],
      [undefined, "part"],
    ])
  })

  test("commentary follows the commentary setting", () => {
    const text = [{ kind: "text" as const }]

    const placement = (detail: TimelineDetail) =>
      place(text, detail, { timeline: "current", commentary: [true] })[0]!.placement

    expect(placement(custom({ commentary: { placement: "grouped" } }))).toBe("grouped")
    expect(placement(custom({ commentary: { placement: "hidden" } }))).toBe("hidden")
    expect(place(text, custom({}), { timeline: "current" })[0]).toEqual({ placement: "separate", group: "part" })
  })

  test("thoughts follow the thinking setting, and open only in the current timeline", () => {
    const detail = custom({ thinking: { placement: "grouped", details: "expanded" } })

    expect(place([{ kind: "thought" }], detail, { timeline: "current" })[0]).toEqual({
      category: "thinking",
      placement: "grouped",
      group: "context",
      opens: true,
    })
    expect(place([{ kind: "thought" }], detail, { timeline: "next" })[0]!.opens).toBe(false)
  })

  test("a failure shows where its setting hides it, and opens in the current timeline", () => {
    const detail = custom({ tools: { placement: "hidden" } })
    const failed = call({ status: "error", failed: true })

    expect(place([failed], detail, { timeline: "current" })[0]).toMatchObject({ placement: "separate", opens: true })
    expect(place([call({})], detail, { timeline: "current" })[0]!.placement).toBe("hidden")
  })

  test("a call stopped before it was written hides in the New timeline", () => {
    const stopped = call({ status: "error", stopped: true, called: false })

    expect(place([stopped], preset("everything"), { timeline: "next" })[0]!.placement).toBe("hidden")
    expect(place([{ ...stopped, called: true }], preset("everything"), { timeline: "next" })[0]!.placement).toBe(
      "separate",
    )
  })

  test("background work stands alone in the New timeline unless its setting groups it", () => {
    const shell = call({ name: "shell", tool: "shell", mode: "run", background: true })

    expect(place([shell], preset("everything"), { timeline: "next" })[0]!.group).toBe("events")
    expect(place([shell], preset("compact"), { timeline: "next" })[0]!.group).toBe("context")
    expect(place([{ ...shell, failed: true }], preset("compact"), { timeline: "next" })[0]!.group).toBe("events")
  })

  test("the placer places each call once", () => {
    const tool = labTool("r", "read", "completed", { path: "/a.ts" })
    let reads = 0
    const placeOf = placer(preset("detailed"), "current", (part) => (reads++, placeFactOf(part)))

    expect(placeOf(tool)).toBe(placeOf(tool))
    expect(reads).toBe(1)
    expect(placeOf(tool)).toEqual(placeContent(tool, preset("detailed"), "current"))
  })
})

describe("placeNotice", () => {
  const switched: SessionMessageInfo = { id: "m", type: "agent-switched", agent: "plan", time: { created: 0 } }

  test("what changed the session stands alone in the New timeline only", () => {
    const detail = custom({ notices: { placement: "hidden" } })

    expect(placeNotice(switched, detail, "next")).toBe("separate")
    expect(placeNotice(switched, detail, "current")).toBe("hidden")
  })
})
