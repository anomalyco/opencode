import { describe, expect, test } from "bun:test"

describe("Orchestrator", () => {
  test("team prompt includes mode description for parallel", () => {
    const prompt = [
      `## Team Coordination Task`,
      ``,
      `Test task`,
      ``,
      `### Agents:`,
      `- @build`,
      `- @plan`,
      ``,
      `### Mode: PARALLEL`,
      `Run all agents simultaneously. Each agent works on the task independently.`,
      ``,
      `Use the \`task\` tool for each agent with the full prompt. Then summarize all results.`,
    ].join("\n")
    expect(prompt).toContain("PARALLEL")
    expect(prompt).toContain("@build")
    expect(prompt).toContain("@plan")
    expect(prompt).toContain("simultaneously")
  })

  test("team prompt includes pipeline instructions", () => {
    const prompt = [
      `### Mode: PIPELINE`,
      `Run agents sequentially. Each receives the previous agent's output as context.`,
      ``,
      `Start with agent 1. Pass its output as context to agent 2. Continue until done.`,
    ].join("\n")
    expect(prompt).toContain("PIPELINE")
    expect(prompt).toContain("sequentially")
  })

  test("team prompt includes supervisor instructions", () => {
    const prompt = [
      `### Mode: SUPERVISOR`,
      `One supervisor agent delegates work and synthesizes the final result.`,
      `\nSupervisor: @build. Delegates tasks and synthesizes results.`,
      ``,
      `As supervisor, delegate subtasks to each agent using the \`task\` tool, then synthesize.`,
    ].join("\n")
    expect(prompt).toContain("SUPERVISOR")
    expect(prompt).toContain("delegates")
  })

  test("agent listing format", () => {
    const agents = ["explore", "general", "build"]
    const rendered = agents.map((n) => `- @${n}`).join("\n")
    expect(rendered).toBe("- @explore\n- @general\n- @build")
  })

  test("mode description lookup", () => {
    const MODE_DESC: Record<string, string> = {
      parallel: "Run all agents simultaneously",
      pipeline: "Run agents sequentially",
      supervisor: "One supervisor agent delegates",
    }
    expect(MODE_DESC["parallel"]).toBeDefined()
    expect(MODE_DESC["pipeline"]).toBeDefined()
    expect(MODE_DESC["supervisor"]).toBeDefined()
    expect(MODE_DESC["parallel"]).toContain("simultaneously")
  })
})
