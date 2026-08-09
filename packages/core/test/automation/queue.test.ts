import { describe, expect, it } from "bun:test"
import { routeAgent, type QueueConfig } from "@opencode-ai/core/automation/queue"
import { Classification } from "@opencode-ai/core/automation/classifier"

const config: Pick<QueueConfig, "agentByTaskType" | "highComplexityAgent"> = {
  agentByTaskType: {
    recon: "explore",
    refactor: "general",
    plan: "plan",
    build: "build",
    verify: "general",
  },
  highComplexityAgent: "build",
}

const cls = (complexity: Classification["complexity"], taskType: Classification["taskType"]): Classification =>
  ({ complexity, taskType, reason: "test" })

describe("AutomationQueue.routeAgent", () => {
  it("routes low-complexity recon to the explore agent", () => {
    expect(routeAgent(cls("low", "recon"), config)).toBe("explore")
  })

  it("routes medium refactor to the bulk worker agent", () => {
    expect(routeAgent(cls("medium", "refactor"), config)).toBe("general")
  })

  it("routes planning to the plan agent", () => {
    expect(routeAgent(cls("low", "plan"), config)).toBe("plan")
  })

  it("routes build work to the build agent", () => {
    expect(routeAgent(cls("medium", "build"), config)).toBe("build")
  })

  it("always routes high-complexity jobs to the careful agent regardless of task type", () => {
    expect(routeAgent(cls("high", "refactor"), config)).toBe("build")
    expect(routeAgent(cls("high", "recon"), config)).toBe("build")
    expect(routeAgent(cls("high", "build"), config)).toBe("build")
  })

  it("returns undefined for an unmapped task type, deferring to the session agent", () => {
    expect(routeAgent(cls("low", "verify"), { ...config, agentByTaskType: {} })).toBeUndefined()
  })
})
