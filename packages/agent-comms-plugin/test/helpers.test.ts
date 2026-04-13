import { describe, it, expect } from "bun:test"
import {
  buildAgentList,
  formatAgentList,
  permissionSummaryForAgent,
  formatPrompt,
  extractResponse,
  formatSystemInject,
} from "../src/helpers"

describe("buildAgentList", () => {
  it("returns built-in non-hidden agents by default", () => {
    const agents = buildAgentList()
    const names = agents.map((a) => a.name)
    expect(names).toContain("build")
    expect(names).toContain("plan")
    expect(names).toContain("general")
    expect(names).toContain("explore")
    expect(names).not.toContain("compaction")
    expect(names).not.toContain("title")
    expect(names).not.toContain("summary")
  })

  it("merges config overrides with built-in defaults", () => {
    const agents = buildAgentList({ build: { description: "Custom build desc" } })
    const build = agents.find((a) => a.name === "build")
    expect(build!.description).toBe("Custom build desc")
  })

  it("includes custom agents from config", () => {
    const agents = buildAgentList({ reviewer: { description: "Code reviewer", mode: "subagent" } })
    const reviewer = agents.find((a) => a.name === "reviewer")
    expect(reviewer).toBeDefined()
    expect(reviewer!.mode).toBe("subagent")
  })

  it("excludes disabled agents", () => {
    const agents = buildAgentList({ build: { disable: true } })
    expect(agents.find((a) => a.name === "build")).toBeUndefined()
  })

  it("excludes hidden custom agents", () => {
    const agents = buildAgentList({ secret: { hidden: true } })
    expect(agents.find((a) => a.name === "secret")).toBeUndefined()
  })

  it("handles missing config gracefully", () => {
    const agents = buildAgentList(undefined)
    expect(agents.length).toBeGreaterThanOrEqual(4)
  })
})

describe("formatAgentList", () => {
  it("formats agent list", () => {
    const agents = buildAgentList()
    const output = formatAgentList(agents)
    expect(output).toContain("Available agent types:")
    expect(output).toContain("build (primary)")
    expect(output).toContain("explore (subagent)")
  })

  it("handles empty list", () => {
    expect(formatAgentList([])).toBe("No agents available.")
  })
})

describe("permissionSummaryForAgent", () => {
  it("returns summary for known agent", () => {
    const agents = buildAgentList()
    expect(permissionSummaryForAgent("build", agents)).toBe("full permissions")
  })

  it("returns 'unknown' for missing agent", () => {
    expect(permissionSummaryForAgent("nonexistent", [])).toBe("unknown")
  })
})

describe("formatPrompt", () => {
  it("formats outgoing prompt with all fields", () => {
    const prompt = formatPrompt({
      fromSessionId: "sess_a",
      fromSessionTitle: "Fix bugs",
      fromAgent: "build",
      toSessionId: "sess_b",
      toAgent: "explore",
      permissionSummary: "subagent, read-only",
      depth: 2,
      maxDepth: 5,
      conversationId: "conv1",
      message: "Find all auth files",
    })
    expect(prompt).toContain("[Agent Communication")
    expect(prompt).toContain('from session "Fix bugs"')
    expect(prompt).toContain("Depth: 2/5")
    expect(prompt).toContain("Conversation: conv1")
    expect(prompt).toContain("Find all auth files")
    expect(prompt).toContain("read-only")
  })
})

describe("extractResponse", () => {
  it("extracts last text part content", () => {
    const result = extractResponse(
      [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
      false,
    )
    expect(result).toBe("world")
  })

  it("includes thinking when include_thinking=true", () => {
    const result = extractResponse(
      [
        { type: "thinking", text: "let me think" },
        { type: "text", text: "answer" },
      ],
      true,
    )
    expect(result).toContain("<thinking>")
    expect(result).toContain("let me think")
    expect(result).toContain("answer")
  })

  it("handles empty response", () => {
    expect(extractResponse([], false)).toBe("")
  })

  it("handles only thinking parts with include_thinking=true", () => {
    const result = extractResponse([{ type: "thinking", text: "hmm" }], true)
    expect(result).toContain("hmm")
  })

  it("excludes thinking when include_thinking=false", () => {
    const result = extractResponse(
      [
        { type: "thinking", text: "hmm" },
        { type: "text", text: "answer" },
      ],
      false,
    )
    expect(result).toBe("answer")
  })
})

describe("formatSystemInject", () => {
  it("formats unread messages notification", () => {
    const result = formatSystemInject({
      unread: [{ from_session: "sess_a", count: 3, agent: "build", title: "Fix bugs" }],
      conversations: [{ id: "conv1", participant_count: 2 }],
      crashes: [],
    })
    expect(result).toContain("[Agent Communication]")
    expect(result).toContain("3 unread")
    expect(result).toContain("sess_a (@build)")
    expect(result).toContain("conv1 (2 sessions)")
  })

  it("formats crash alert", () => {
    const result = formatSystemInject({
      unread: [],
      conversations: [],
      crashes: [{ session_id: "sess_b", agent: "explore", error: "timeout", max_retry: 2 }],
    })
    expect(result).toContain("[Agent Communication — Alerts]")
    expect(result).toContain("crashed after 2 retries")
    expect(result).toContain("/undo sess_b")
  })

  it("returns empty string when nothing to report", () => {
    const result = formatSystemInject({ unread: [], conversations: [], crashes: [] })
    expect(result).toBe("")
  })

  it("handles both unread and crashes simultaneously", () => {
    const result = formatSystemInject({
      unread: [{ from_session: "a", count: 1, agent: "build", title: "t" }],
      conversations: [],
      crashes: [{ session_id: "b", agent: "explore", error: "err", max_retry: 1 }],
    })
    expect(result).toContain("[Agent Communication]")
    expect(result).toContain("[Agent Communication — Alerts]")
  })
})
