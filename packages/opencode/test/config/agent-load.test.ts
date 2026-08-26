import { expect, test, describe } from "bun:test"
import { ConfigAgent } from "@/config/agent"
import path from "path"

describe("ConfigAgent.load: interpolation warnings", () => {
  const dir = path.join(import.meta.dir, "fixtures/agent-warnings")

  test("attributes an unresolved reference to its agent and source file", async () => {
    const result = await ConfigAgent.load(dir)

    expect(result.warnings).toHaveLength(1)
    const warning = result.warnings[0]
    expect(warning.agent).toBe("broken-ref")
    expect(warning.source).toBe(path.join(dir, "agents/broken-ref.md"))
    expect(warning.error).toEqual({
      type: "not_found",
      refPath: "./missing.md",
      resolvedPath: path.join(dir, "agents/missing.md"),
    })
  })

  test("still loads the agent, leaving a marker in the prompt", async () => {
    const result = await ConfigAgent.load(dir)

    const agent = result.agent["broken-ref"]
    expect(agent.prompt).toContain("<!-- File not found: ./missing.md -->")
    expect(agent.prompt).toContain("Before")
    expect(agent.prompt).toContain("After")
  })

  test("reports no warnings for agents without file references", async () => {
    const result = await ConfigAgent.load(dir)

    expect(result.agent["clean"]).toBeDefined()
    expect(result.warnings.some((w) => w.agent === "clean")).toBe(false)
  })
})
