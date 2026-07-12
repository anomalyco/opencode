import { describe, expect, test } from "bun:test"
import {
  collectSearchUnits,
  estimateRenderedLine,
  findSearchHits,
  highlightSegments,
  initialSearchIndex,
  moveSearchIndex,
  searchHighlights,
} from "../../src/util/session-search"

describe("collectSearchUnits", () => {
  const messages = [
    { id: "msg_1", role: "user" },
    { id: "msg_2", role: "assistant" },
  ]
  const parts = {
    msg_1: [
      { id: "prt_1", type: "text", text: "first part" },
      { id: "prt_2", type: "text", text: "synthetic part", synthetic: true },
      { id: "prt_3", type: "text", text: "second part" },
      { id: "prt_4", type: "file" },
    ],
    msg_2: [
      { id: "prt_5", type: "text", text: "  reply text  " },
      { id: "prt_6", type: "reasoning", text: "[REDACTED]thinking hard" },
      { id: "prt_7", type: "text", text: "   " },
      { id: "prt_8", type: "tool", text: "tool output" },
    ],
  }

  test("mirrors rendered content per role", () => {
    const units = collectSearchUnits(messages, parts)
    expect(units).toEqual([
      { anchorID: "msg_1", messageID: "msg_1", role: "user", kind: "text", text: "first part\n\nsecond part" },
      { anchorID: "prt_5", messageID: "msg_2", role: "assistant", kind: "text", text: "reply text" },
      { anchorID: "prt_6", messageID: "msg_2", role: "assistant", kind: "reasoning", text: "thinking hard" },
    ])
  })

  test("excludes messages hidden by revert", () => {
    const units = collectSearchUnits(messages, parts, "msg_2")
    expect(units.map((unit) => unit.messageID)).toEqual(["msg_1"])
  })

  test("drops empty units and handles missing parts", () => {
    const units = collectSearchUnits([{ id: "msg_x", role: "user" }], {})
    expect(units).toEqual([])
  })
})

describe("findSearchHits", () => {
  const unit = {
    anchorID: "prt_1",
    messageID: "msg_1",
    role: "assistant" as const,
    kind: "text" as const,
    text: "alpha beta\ngamma Beta delta",
  }

  test("finds every occurrence with offsets and lines", () => {
    const hits = findSearchHits([unit], "beta")
    expect(hits).toEqual([
      { ...unit, start: 6, end: 10, line: 0 },
      { ...unit, start: 17, end: 21, line: 1 },
    ])
  })

  test("smartcase: uppercase in query forces case-sensitive match", () => {
    const hits = findSearchHits([unit], "Beta")
    expect(hits).toEqual([{ ...unit, start: 17, end: 21, line: 1 }])
  })

  test("treats regex metacharacters literally", () => {
    const weird = { ...unit, text: "a.b axb" }
    expect(findSearchHits([weird], "a.b")).toEqual([{ ...weird, start: 0, end: 3, line: 0 }])
  })

  test("matches are non-overlapping", () => {
    const aaa = { ...unit, text: "aaa" }
    expect(findSearchHits([aaa], "aa")).toEqual([{ ...aaa, start: 0, end: 2, line: 0 }])
  })

  test("blank query yields nothing", () => {
    expect(findSearchHits([unit], "")).toEqual([])
    expect(findSearchHits([unit], "   ")).toEqual([])
  })

  test("astral characters before the match keep offsets aligned", () => {
    const emoji = { ...unit, text: "🚀🚀 beta" }
    const hits = findSearchHits([emoji], "beta")
    expect(hits).toHaveLength(1)
    expect(emoji.text.slice(hits[0].start, hits[0].end)).toBe("beta")
  })

  test("astral characters in the query do not throw", () => {
    const emoji = { ...unit, text: "ship 🚀 it" }
    expect(findSearchHits([emoji], "🚀")).toHaveLength(1)
    expect(findSearchHits([emoji], "{[(")).toEqual([])
  })
})

describe("moveSearchIndex", () => {
  test("wraps in both directions", () => {
    expect(moveSearchIndex(3, 2, "next")).toBe(0)
    expect(moveSearchIndex(3, 0, "previous")).toBe(2)
    expect(moveSearchIndex(3, 1, "next")).toBe(2)
  })

  test("empty set yields -1", () => {
    expect(moveSearchIndex(0, 0, "next")).toBe(-1)
  })
})

describe("initialSearchIndex", () => {
  const ys = [2, 10, 20, 30, undefined]

  test("reverse picks the last hit at or above the viewport bottom", () => {
    expect(initialSearchIndex(ys, 8, 18, "previous")).toBe(1)
  })

  test("reverse wraps to the bottom-most hit when everything is below", () => {
    expect(initialSearchIndex(ys, 0, 1, "previous")).toBe(3)
  })

  test("forward picks the first hit at or below the viewport top", () => {
    expect(initialSearchIndex(ys, 15, 25, "next")).toBe(2)
  })

  test("forward wraps to the first hit when everything is above", () => {
    expect(initialSearchIndex(ys, 50, 60, "next")).toBe(0)
  })

  test("ignores unmounted anchors and empty sets", () => {
    expect(initialSearchIndex([undefined, undefined], 0, 10, "previous")).toBe(-1)
  })
})

describe("highlightSegments", () => {
  test("partitions text into matched and unmatched segments", () => {
    const segments = highlightSegments("one two one", "one")
    expect(segments).toEqual([
      { text: "one", start: 0, match: true },
      { text: " two ", start: 3, match: false },
      { text: "one", start: 8, match: true },
    ])
    expect(segments.map((segment) => segment.text).join("")).toBe("one two one")
  })

  test("returns a single segment when nothing matches", () => {
    expect(highlightSegments("plain", "zzz")).toEqual([{ text: "plain", start: 0, match: false }])
    expect(highlightSegments("plain", "")).toEqual([{ text: "plain", start: 0, match: false }])
  })
})

describe("searchHighlights", () => {
  test("returns opentui highlight tuples for every occurrence", () => {
    expect(searchHighlights("one two one", "one")).toEqual([
      [0, 3, "search.match"],
      [8, 11, "search.match"],
    ])
  })

  test("blank query yields nothing", () => {
    expect(searchHighlights("anything", "")).toEqual([])
  })

  test("marks the occurrence at the active offset with the active scope", () => {
    expect(searchHighlights("one two one", "one", 8)).toEqual([
      [0, 3, "search.match"],
      [8, 11, "search.match.active"],
    ])
  })
})

describe("estimateRenderedLine", () => {
  test("counts one row per short line", () => {
    expect(estimateRenderedLine("a\nb\nc", 2, 80)).toBe(2)
  })

  test("adds rows for lines that soft-wrap", () => {
    const text = `${"x".repeat(25)}\nshort\ntarget`
    expect(estimateRenderedLine(text, 2, 10)).toBe(4)
  })

  test("line zero renders at row zero", () => {
    expect(estimateRenderedLine("anything", 0, 10)).toBe(0)
  })
})
