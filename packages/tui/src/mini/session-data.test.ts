import { describe, expect, it } from "bun:test"
import { descendantActivityModel, descendantActivityStatus, footerActivityStatus } from "./session-data"

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