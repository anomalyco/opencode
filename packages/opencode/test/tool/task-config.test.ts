import { describe, expect, it } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { resolveCompletionMode, resolveContextMode } from "../../src/tool/task"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

// Direct unit tests for the typed resolvers — these test precedence without needing the full test layer
describe("resolveCompletionMode", () => {
  const baseAgent = {
    name: "build",
    mode: "primary" as const,
    options: {},
    permission: [],
    completion: undefined as "full" | "terse" | undefined,
    context: undefined as "full" | "sparse" | undefined,
  }

  const agent = (completion?: "full" | "terse"): typeof baseAgent => ({
    ...baseAgent,
    completion,
  })

  function cfg(completion?: "full" | "terse"): Partial<ConfigV1.Info> {
    return { task: completion ? { completion } : undefined }
  }

  it("defaults to full when nothing is set", () => {
    const result = resolveCompletionMode(undefined, agent() as Agent.Info, cfg() as ConfigV1.Info)
    expect(result).toBe("full")
  })

  it("global config task.completion=terse wins over default", () => {
    const result = resolveCompletionMode(undefined, agent() as Agent.Info, cfg("terse") as ConfigV1.Info)
    expect(result).toBe("terse")
  })

  it("agent frontmatter completion overrides config", () => {
    const result = resolveCompletionMode(undefined, agent("terse") as Agent.Info, cfg("full") as ConfigV1.Info)
    expect(result).toBe("terse")
  })

  it("dispatch param completion overrides all", () => {
    const result = resolveCompletionMode("terse", agent("full") as Agent.Info, cfg("full") as ConfigV1.Info)
    expect(result).toBe("terse")
  })

  it("dispatch param full overrides agent terse", () => {
    const result = resolveCompletionMode("full", agent("terse") as Agent.Info, cfg("full") as ConfigV1.Info)
    expect(result).toBe("full")
  })
})

describe("resolveContextMode", () => {
  const baseAgent = {
    name: "build",
    mode: "primary" as const,
    options: {},
    permission: [],
    completion: undefined as "full" | "terse" | undefined,
    context: undefined as "full" | "sparse" | undefined,
  }

  const agent = (context?: "full" | "sparse"): typeof baseAgent => ({
    ...baseAgent,
    context,
  })

  function cfg(context?: "full" | "sparse"): Partial<ConfigV1.Info> {
    return { task: context ? { context } : undefined }
  }

  it("defaults to full when nothing is set", () => {
    const result = resolveContextMode(undefined, agent() as Agent.Info, cfg() as ConfigV1.Info)
    expect(result).toBe("full")
  })

  it("config task.context=sparse wins over default", () => {
    const result = resolveContextMode(undefined, agent() as Agent.Info, cfg("sparse") as ConfigV1.Info)
    expect(result).toBe("sparse")
  })

  it("agent context overrides config", () => {
    const result = resolveContextMode(undefined, agent("sparse") as Agent.Info, cfg("full") as ConfigV1.Info)
    expect(result).toBe("sparse")
  })

  it("dispatch param context overrides all", () => {
    const result = resolveContextMode("sparse", agent("full") as Agent.Info, cfg("full") as ConfigV1.Info)
    expect(result).toBe("sparse")
  })

  it("dispatch param full overrides agent sparse", () => {
    const result = resolveContextMode("full", agent("sparse") as Agent.Info, cfg("full") as ConfigV1.Info)
    expect(result).toBe("full")
  })
})