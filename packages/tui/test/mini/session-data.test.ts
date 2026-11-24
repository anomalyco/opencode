import { describe, expect, it } from "bun:test"
import { descendantActivityModel, descendantActivityStatus, footerActivityStatus, activeToolSummaries } from "../../src/mini/session-data"

describe("descendantActivityStatus", () => {
  it("shows running child", () => {
    const status = descendantActivityStatus({
      tabs: [
        {
          sessionID: "ses_parent_child1234",
          label: "developer",
          description: "",
          status: "running",
        },
      ],
      details: {},
      permissions: [],
      forms: [],
    })
    expect(status).toContain("task:developer")
    expect(status).toContain("child1234")
  })
})

describe("descendantActivityModel", () => {
  const makeState = (tabs: Parameters<typeof descendantActivityStatus>[0]["tabs"]) => ({
    tabs,
    details: {},
    permissions: [],
    forms: [],
  })

  it("returns undefined when no tabs running", () => {
    expect(descendantActivityModel(makeState([]))).toBeUndefined()
  })

  it("returns undefined when running tab has no model", () => {
    const result = descendantActivityModel(
      makeState([{ sessionID: "ses_1", label: "researcher", description: "", status: "running" }]),
    )
    expect(result).toBeUndefined()
  })

  it("returns model when exactly one tab is running with model", () => {
    const result = descendantActivityModel(
      makeState([
        {
          sessionID: "ses_1",
          label: "researcher",
          description: "",
          status: "running",
          model: { providerID: "hai-google", modelID: "gemini-3.5-flash" },
        },
      ]),
    )
    expect(result).toEqual({ providerID: "hai-google", modelID: "gemini-3.5-flash" })
  })

  it("returns undefined when two or more tabs are running", () => {
    const result = descendantActivityModel(
      makeState([
        {
          sessionID: "ses_1",
          label: "researcher",
          description: "",
          status: "running",
          model: { providerID: "hai-google", modelID: "gemini-3.5-flash" },
        },
        {
          sessionID: "ses_2",
          label: "coder",
          description: "",
          status: "running",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        },
      ]),
    )
    expect(result).toBeUndefined()
  })

  it("ignores completed tabs when counting running", () => {
    const result = descendantActivityModel(
      makeState([
        {
          sessionID: "ses_done",
          label: "old",
          description: "",
          status: "completed",
          model: { providerID: "openai", modelID: "gpt-4o" },
        },
        {
          sessionID: "ses_active",
          label: "researcher",
          description: "",
          status: "running",
          model: { providerID: "hai-google", modelID: "gemini-3.5-flash" },
        },
      ]),
    )
    expect(result).toEqual({ providerID: "hai-google", modelID: "gemini-3.5-flash" })
  })
})

describe("footerActivityStatus", () => {
  it("stays idle when only child is active (parent must not arm two-press interrupt)", () => {
    const empty = { tabs: [], details: {}, permissions: [], forms: [] }
    const out = footerActivityStatus({ type: "prompt" }, empty, false)
    expect(out.phase).toBe("idle")
    const child = footerActivityStatus(
      { type: "prompt" },
      {
        tabs: [{ sessionID: "ses_x", label: "developer", description: "", status: "running" }],
        details: {},
        permissions: [],
        forms: [],
      },
      false,
    )
    // Phase must stay idle so the footer renders task: status without enabling the parent interrupt.
    expect(child.phase).toBe("idle")
    expect(child.status).toContain("task:")
  })
})

describe("activeToolSummaries", () => {
  const makeTab = (
    overrides: Partial<import("../../src/mini/types").FooterSubagentTab>,
  ): import("../../src/mini/types").FooterSubagentTab => ({
    sessionID: "ses_test",
    label: "developer",
    description: "",
    status: "running",
    ...overrides,
  })

  it("returns empty array when no running tabs", () => {
    const result = activeToolSummaries(
      [makeTab({ status: "completed" })],
      Date.now(),
    )
    expect(result).toEqual([])
  })

  it("excludes non-running tabs", () => {
    const result = activeToolSummaries([makeTab({ status: "completed", activeTool: "read" })], Date.now())
    expect(result).toEqual([])
  })

  it("includes a running tab without an active tool as a thinking row", () => {
    const now = Date.now()
    const tabs: import("../../src/mini/types").FooterSubagentTab[] = [
      { sessionID: "s1", label: "agent-1", description: "", status: "running", lastUpdatedAt: now - 3000 },
    ]
    const result = activeToolSummaries(tabs, now)
    expect(result).toHaveLength(1)
    expect(result[0]!.tool).toBe("")
    expect(result[0]!.elapsedMs).toBeGreaterThanOrEqual(2900)
    expect(result[0]!.elapsedMs).toBeLessThanOrEqual(3100)
  })

  it("thinking row has zero elapsed when the tab has no timestamp", () => {
    const tabs: import("../../src/mini/types").FooterSubagentTab[] = [
      { sessionID: "s1", label: "agent-1", description: "", status: "running" },
    ]
    const result = activeToolSummaries(tabs, 1000)
    expect(result).toHaveLength(1)
    expect(result[0]!.tool).toBe("")
    expect(result[0]!.elapsedMs).toBe(0)
  })

  it("includes running tab with active tool", () => {
    const now = Date.now()
    const result = activeToolSummaries(
      [makeTab({ activeTool: "mcp__filesystem__read_file", toolStart: now - 5000 })],
      now,
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.tool).toBe("mcp__filesystem__read_file")
    expect(result[0]!.elapsedMs).toBeGreaterThanOrEqual(4900)
    expect(result[0]!.elapsedMs).toBeLessThanOrEqual(5100)
  })

  it("returns one row per running tab", () => {
    const now = Date.now()
    const result = activeToolSummaries(
      [
        makeTab({ sessionID: "ses_a", label: "developer", activeTool: "bash", toolStart: now - 1000 }),
        makeTab({ sessionID: "ses_b", label: "researcher", activeTool: "websearch", toolStart: now - 2000 }),
        makeTab({ sessionID: "ses_c", label: "done", status: "completed" }),
      ],
      now,
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.label).toBe("developer")
    expect(result[1]!.label).toBe("researcher")
  })

  it("inputPreview is empty string (input not in tab snapshot)", () => {
    const result = activeToolSummaries(
      [makeTab({ activeTool: "bash", toolStart: Date.now() })],
      Date.now(),
    )
    expect(result[0]!.inputPreview).toBe("")
  })
})
