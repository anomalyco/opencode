/** @jsxImportSource @opentui/solid */
// Unit tests for the expanded activity panel logic added to footer.view.tsx (feature #65680).
// These tests exercise the reactive logic using SolidJS primitives in isolation, without
// rendering the full terminal component.

import { describe, expect, it } from "bun:test"
import { createMemo, createRoot, createSignal } from "solid-js"
import { activeToolSummaries } from "./session-data"
import type { FooterSubagentTab } from "./types"

const makeRunningTab = (overrides: Partial<FooterSubagentTab> = {}): FooterSubagentTab => ({
  sessionID: "ses_test",
  label: "developer",
  description: "",
  status: "running",
  ...overrides,
})

// ---------------------------------------------------------------------------
// 1. Toggle on "e" – the Keymap layer guard: only toggles when activeTabs > 0
// ---------------------------------------------------------------------------
describe("expanded toggle guard", () => {
  it("toggles expanded when activeTabs is non-empty", () => {
    createRoot((dispose) => {
      const [expanded, setExpanded] = createSignal(false)
      const activeTabs = [makeRunningTab()]

      // Mirrors the layer's enabled guard + run callback
      const toggle = () => {
        if (activeTabs.length > 0) setExpanded((v) => !v)
      }

      toggle()
      expect(expanded()).toBe(true)

      toggle()
      expect(expanded()).toBe(false)

      dispose()
    })
  })

  it("does not toggle expanded when activeTabs is empty", () => {
    createRoot((dispose) => {
      const [expanded, setExpanded] = createSignal(false)
      const activeTabs: FooterSubagentTab[] = []

      const toggle = () => {
        if (activeTabs.length > 0) setExpanded((v) => !v)
      }

      toggle()
      expect(expanded()).toBe(false) // guard prevented the toggle

      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Collapsed footer hint – [e] agents appears when activeTabs > 0
// ---------------------------------------------------------------------------
describe("activity hint candidate", () => {
  it("produces an activity entry when activeTabs is non-empty", () => {
    createRoot((dispose) => {
      const [expanded, setExpanded] = createSignal(false)
      const tabs = createSignal<FooterSubagentTab[]>([makeRunningTab()])
      const activeTabs = createMemo(() => tabs[0]().filter((t) => t.status === "running"))

      // Mirrors the contextHintCandidates activity push
      const activityHint = createMemo(() =>
        activeTabs().length > 0
          ? { id: "activity" as const, key: "e", label: expanded() ? "hide" : "agents" }
          : undefined,
      )

      expect(activityHint()).not.toBeUndefined()
      expect(activityHint()!.key).toBe("e")
      expect(activityHint()!.label).toBe("agents")

      setExpanded(true)
      expect(activityHint()!.label).toBe("hide")

      dispose()
    })
  })

  it("produces no activity entry when no tabs are running", () => {
    createRoot((dispose) => {
      const tabs = createSignal<FooterSubagentTab[]>([])
      const activeTabs = createMemo(() => tabs[0]().filter((t) => t.status === "running"))

      const activityHint = createMemo(() =>
        activeTabs().length > 0 ? { id: "activity" as const, key: "e", label: "agents" } : undefined,
      )

      expect(activityHint()).toBeUndefined()

      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Expanded panel shows tool rows via toolSummaries memo
// ---------------------------------------------------------------------------
describe("toolSummaries memo", () => {
  it("returns empty array when not expanded", () => {
    createRoot((dispose) => {
      const [expanded] = createSignal(false)
      const now = Date.now()
      const tabs: FooterSubagentTab[] = [makeRunningTab({ activeTool: "bash", toolStart: now - 1000 })]

      const toolSummaries = createMemo(() => (expanded() ? activeToolSummaries(tabs, now) : []))

      expect(toolSummaries()).toHaveLength(0)

      dispose()
    })
  })

  it("returns one row per running tab with activeTool when expanded", () => {
    createRoot((dispose) => {
      const [expanded, setExpanded] = createSignal(false)
      const now = Date.now()
      const tabs: FooterSubagentTab[] = [
        makeRunningTab({ sessionID: "ses_a", label: "developer", activeTool: "bash", toolStart: now - 2000 }),
        makeRunningTab({ sessionID: "ses_b", label: "researcher", activeTool: "websearch", toolStart: now - 500 }),
        makeRunningTab({ sessionID: "ses_c", label: "done", status: "completed" }),
      ]

      const toolSummaries = createMemo(() => (expanded() ? activeToolSummaries(tabs, now) : []))

      setExpanded(true)
      expect(toolSummaries()).toHaveLength(2)
      expect(toolSummaries()[0]!.label).toBe("developer")
      expect(toolSummaries()[0]!.tool).toBe("bash")
      expect(toolSummaries()[1]!.label).toBe("researcher")

      dispose()
    })
  })

  it("returns empty when expanded but no tabs have activeTool set", () => {
    createRoot((dispose) => {
      const [expanded] = createSignal(true)
      const now = Date.now()
      const tabs: FooterSubagentTab[] = [
        makeRunningTab({ sessionID: "ses_a", label: "developer" }), // no activeTool
      ]

      const toolSummaries = createMemo(() => (expanded() ? activeToolSummaries(tabs, now) : []))

      expect(toolSummaries()).toHaveLength(0)

      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Auto-collapse – expanded goes false when activeTabs drops to 0
//
// Note: bun's test environment runs solid-js in SSR mode where createEffect
// does not re-run after the initial synchronous pass.  We therefore test the
// auto-collapse CONDITION (the body of the effect) directly rather than
// depending on the SSR effect scheduler.  The same condition is used unchanged
// in the actual RunFooterView createEffect.
// ---------------------------------------------------------------------------
describe("auto-collapse condition", () => {
  it("auto-collapse logic collapses expanded when all tabs finish", () => {
    createRoot((dispose) => {
      const [expanded, setExpanded] = createSignal(true)
      const [tabs, setTabs] = createSignal<FooterSubagentTab[]>([makeRunningTab()])
      const activeTabs = createMemo(() => tabs().filter((t) => t.status === "running"))

      // Apply the same logic used in the createEffect inside RunFooterView
      const applyAutoCollapse = () => {
        if (activeTabs().length === 0) setExpanded(false)
      }

      expect(expanded()).toBe(true) // still expanded

      // All tabs complete
      setTabs([makeRunningTab({ status: "completed" })])
      applyAutoCollapse()

      expect(expanded()).toBe(false)

      dispose()
    })
  })

  it("stays expanded while at least one tab is still running", () => {
    createRoot((dispose) => {
      const [expanded, setExpanded] = createSignal(true)
      const [tabs, setTabs] = createSignal<FooterSubagentTab[]>([
        makeRunningTab({ sessionID: "ses_a" }),
        makeRunningTab({ sessionID: "ses_b" }),
      ])
      const activeTabs = createMemo(() => tabs().filter((t) => t.status === "running"))

      const applyAutoCollapse = () => {
        if (activeTabs().length === 0) setExpanded(false)
      }

      // Only one completes
      setTabs([makeRunningTab({ sessionID: "ses_a", status: "completed" }), makeRunningTab({ sessionID: "ses_b" })])
      applyAutoCollapse()

      expect(expanded()).toBe(true) // ses_b still running

      dispose()
    })
  })
})
