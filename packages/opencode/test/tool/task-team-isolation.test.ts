import { describe, expect, test } from "bun:test"

/**
 * Tests that task subagents are isolated from the team communication graph.
 *
 * The TEAM_TOOLS constant in task.ts lists all 9 team tools that must be
 * denied for subagents. These tests verify:
 * 1. The constant covers every team tool defined in team.ts
 * 2. The deny rules and tool visibility are correctly generated
 */

/** Read the team tool IDs from team.ts without importing its runtime provider dependencies. */
async function readTeamToolIDsFromSource() {
  const src = await Bun.file(new URL("../../src/tool/team.ts", import.meta.url).pathname).text()
  return [...src.matchAll(/Tool\.define<[\s\S]*?>\(\s*\n\s*"([^"]+)"/g)].map((m) => m[1])
}

/** Read the task.ts source to extract the TEAM_TOOLS constant */
async function readTeamToolsFromSource() {
  const src = await Bun.file(new URL("../../src/tool/task.ts", import.meta.url).pathname).text()

  // Extract the TEAM_TOOLS array contents between [ and ] as const
  const match = src.match(/const TEAM_TOOLS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!match) throw new Error("TEAM_TOOLS constant not found in task.ts")

  // Parse the quoted strings from the array
  const tools = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  return tools
}

describe("task subagent team tool isolation", () => {
  test("TEAM_TOOLS constant exists in task.ts", async () => {
    const tools = await readTeamToolsFromSource()
    expect(tools.length).toBeGreaterThan(0)
  })

  test("TEAM_TOOLS covers all 9 team tools", async () => {
    const tools = await readTeamToolsFromSource()
    const teamToolIDs = await readTeamToolIDsFromSource()
    expect(tools.length).toBe(9)
    for (const id of teamToolIDs) {
      expect(tools).toContain(id)
    }
  })

  test("TEAM_TOOLS contains no duplicates", async () => {
    const tools = await readTeamToolsFromSource()
    const unique = new Set(tools)
    expect(unique.size).toBe(tools.length)
  })

  test("TEAM_TOOLS matches authoritative team tool IDs exactly", async () => {
    const tools = await readTeamToolsFromSource()
    const teamToolIDs = await readTeamToolIDsFromSource()
    expect(tools.sort()).toEqual(teamToolIDs.sort())
  })

  test("task.ts denies team tools in session permission rules", async () => {
    const src = await Bun.file(new URL("../../src/tool/task.ts", import.meta.url).pathname).text()

    // Verify the TEAM_TOOLS.map deny pattern exists in the permission array
    expect(src).toContain("...TEAM_TOOLS.map((t) => ({")
    expect(src).toContain('action: "deny" as const')

    // Verify it's inside the child session deny list.
    const permissionSection = src.slice(src.indexOf("const childToolDenies = ["), src.indexOf("const nextSession ="))
    expect(permissionSection).toContain("TEAM_TOOLS.map")
  })

  test("task.ts isolates team tools through session permissions", async () => {
    const src = await Bun.file(new URL("../../src/tool/task.ts", import.meta.url).pathname).text()

    expect(src).toContain("const childToolDenies = [")
    expect(src).toContain("...TEAM_TOOLS.map((t) => ({")
    expect(src).not.toContain("Object.fromEntries(TEAM_TOOLS")
  })

  test("teammate system prompt documents relay pattern", async () => {
    const src = await Bun.file(new URL("../../src/team/index.ts", import.meta.url).pathname).text()

    expect(src).toContain("SUBAGENT RELAY")
    expect(src).toContain("they CANNOT communicate with the team")
    expect(src).toContain("relaying any relevant subagent findings")
  })

  test("team members can delegate to nested subagents without adding them to the team graph", async () => {
    const permissionSrc = await Bun.file(new URL("../../src/agent/subagent-permissions.ts", import.meta.url).pathname).text()
    expect(permissionSrc).toContain("const canTask = (input.subagent.task_budget ?? 0) > 0")
    expect(permissionSrc).toContain('...(canTask ? [] : [{ permission: "task"')
    expect(await readTeamToolsFromSource()).toEqual(await readTeamToolIDsFromSource())

    const teamSrc = await Bun.file(new URL("../../src/team/index.ts", import.meta.url).pathname).text()
    expect(teamSrc).toContain("SUBAGENT RELAY")
    expect(teamSrc).toContain("they CANNOT communicate with the team")
  })
})
