import { describe, expect, test } from "bun:test"
import {
  formatDepthBadge,
  formatOriginAttribution,
  formatSubagentLabel,
  sessionBreadcrumb,
  sessionDepth,
  sessionLineage,
} from "../../src/util/lineage"

// Minimal session graph: root → child → grandchild. Order is intentionally
// shuffled to prove the walk does not depend on array ordering.
const SESSIONS = [
  { id: "ses_grand", parentID: "ses_child", title: "@reviewer subagent" },
  { id: "ses_root", title: "Top level chat" },
  { id: "ses_child", parentID: "ses_root", title: "@builder subagent" },
]

describe("util.lineage.sessionLineage", () => {
  test("walks the parent chain root→leaf", () => {
    expect(sessionLineage(SESSIONS, "ses_grand").map((s) => s.id)).toEqual(["ses_root", "ses_child", "ses_grand"])
  })

  test("a root session is its own single-element lineage", () => {
    expect(sessionLineage(SESSIONS, "ses_root").map((s) => s.id)).toEqual(["ses_root"])
  })

  test("an unknown session yields an empty lineage", () => {
    expect(sessionLineage(SESSIONS, "ses_missing")).toEqual([])
  })

  test("a broken/dangling parent link stops the walk without throwing", () => {
    const orphan = [{ id: "ses_a", parentID: "ses_gone", title: "Orphan" }]
    expect(sessionLineage(orphan, "ses_a").map((s) => s.id)).toEqual(["ses_a"])
  })

  test("a parent cycle terminates instead of looping forever", () => {
    const cyclic = [
      { id: "ses_x", parentID: "ses_y", title: "X" },
      { id: "ses_y", parentID: "ses_x", title: "Y" },
    ]
    // The walk must terminate; the exact truncation point is an implementation
    // detail, but the result is finite and contains the start session.
    const chain = sessionLineage(cyclic, "ses_x")
    expect(chain.length).toBeLessThanOrEqual(2)
    expect(chain.some((s) => s.id === "ses_x")).toBeTrue()
  })
})

describe("util.lineage.sessionDepth", () => {
  test("root is depth 1, child 2, grandchild 3", () => {
    expect(sessionDepth(SESSIONS, "ses_root")).toBe(1)
    expect(sessionDepth(SESSIONS, "ses_child")).toBe(2)
    expect(sessionDepth(SESSIONS, "ses_grand")).toBe(3)
  })

  test("an unknown session has depth 0", () => {
    expect(sessionDepth(SESSIONS, "ses_missing")).toBe(0)
  })
})

describe("util.lineage.sessionBreadcrumb", () => {
  test("returns the title chain root→leaf", () => {
    expect(sessionBreadcrumb(SESSIONS, "ses_grand")).toEqual([
      "Top level chat",
      "@builder subagent",
      "@reviewer subagent",
    ])
  })

  test("is a single entry for a root session", () => {
    expect(sessionBreadcrumb(SESSIONS, "ses_root")).toEqual(["Top level chat"])
  })
})

describe("util.lineage.formatDepthBadge", () => {
  test("renders a depth-N badge for nested sessions", () => {
    expect(formatDepthBadge(3)).toBe("L3")
  })

  test("renders nothing for the root level or invalid depth", () => {
    expect(formatDepthBadge(1)).toBe("")
    expect(formatDepthBadge(0)).toBe("")
    expect(formatDepthBadge(undefined)).toBe("")
  })
})

describe("util.lineage.formatSubagentLabel", () => {
  test("prefixes a depth badge for nested subagent task cards", () => {
    expect(formatSubagentLabel("Reviewer", 3)).toBe("L3 Reviewer")
  })

  test("leaves the label untouched at the root level or unknown depth", () => {
    expect(formatSubagentLabel("Reviewer", 1)).toBe("Reviewer")
    expect(formatSubagentLabel("Reviewer", 0)).toBe("Reviewer")
    expect(formatSubagentLabel("Reviewer", undefined)).toBe("Reviewer")
  })
})

describe("util.lineage.formatOriginAttribution", () => {
  test("renders agent + depth from permission origin metadata", () => {
    expect(
      formatOriginAttribution({
        originSessionID: "ses_child",
        originAgent: "reviewer",
        originDepth: 3,
      }),
    ).toBe("asked by @reviewer (depth 3)")
  })

  test("omits the depth clause when no origin depth is present", () => {
    expect(
      formatOriginAttribution({
        originSessionID: "ses_child",
        originAgent: "reviewer",
      }),
    ).toBe("asked by @reviewer")
  })

  test("falls back to a generic label when the agent is missing", () => {
    expect(
      formatOriginAttribution({
        originSessionID: "ses_child",
        originDepth: 2,
      }),
    ).toBe("asked by a subagent (depth 2)")
  })

  test("returns undefined when the ask did not originate elsewhere", () => {
    expect(formatOriginAttribution(undefined)).toBeUndefined()
    expect(formatOriginAttribution({})).toBeUndefined()
    expect(formatOriginAttribution({ filepath: "/tmp/x" })).toBeUndefined()
  })

  test("ignores malformed origin field types", () => {
    expect(
      formatOriginAttribution({
        originSessionID: 123 as unknown as string,
        originAgent: { not: "a string" },
        originDepth: "deep",
      }),
    ).toBeUndefined()
  })
})
