import { describe, it, expect } from "bun:test"
import { createAgentListTool } from "../../src/tools/agent-list"

describe("agent_list tool", () => {
  it("returns list of non-hidden agents", async () => {
    const tool = createAgentListTool(undefined)
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("build")
    expect(result).toContain("plan")
    expect(result).toContain("general")
    expect(result).toContain("explore")
  })

  it("excludes hidden agents (compaction, title, summary)", async () => {
    const tool = createAgentListTool(undefined)
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).not.toContain("compaction")
    expect(result).not.toContain("title")
    expect(result).not.toContain("summary")
  })

  it("includes permission summary for each agent", async () => {
    const tool = createAgentListTool(undefined)
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("full permissions")
    expect(result).toContain("plan mode, no edits")
  })

  it("includes agent mode (primary/subagent)", async () => {
    const tool = createAgentListTool(undefined)
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("primary")
    expect(result).toContain("subagent")
  })

  it("includes agent description", async () => {
    const tool = createAgentListTool(undefined)
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("Default agent")
    expect(result).toContain("exploring codebases")
  })

  it("merges config overrides with built-in defaults", async () => {
    const tool = createAgentListTool({ build: { description: "Custom builder" } })
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("Custom builder")
  })

  it("includes custom agents from config", async () => {
    const tool = createAgentListTool({
      reviewer: { description: "Code reviewer agent", mode: "subagent" },
    })
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("reviewer")
    expect(result).toContain("Code reviewer agent")
  })

  it("handles missing config gracefully (defaults only)", async () => {
    const tool = createAgentListTool(undefined)
    const result = await tool.execute({}, {
      sessionID: "s1",
      messageID: "m1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
    } as any)
    expect(result).toContain("Available agent types:")
    expect(result).toContain("build (primary)")
    expect(result).toContain("explore (subagent)")
  })
})
