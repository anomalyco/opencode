import { describe, expect, test } from "bun:test"

/**
 * Tests that task subagents are isolated from the team communication graph.
 *
 * The TEAM_TOOLS constant in task.ts lists all 9 team tools that must be
 * denied for subagents. These tests verify:
 * 1. The constant covers every team tool defined in team.ts
 * 2. The deny rules and tool visibility are correctly generated
 */

// We can't directly import the private TEAM_TOOLS constant, so we
// verify via the module's exported behavior. We do import the team
// tool exports to get the authoritative list of team tool IDs.
import {
  TeamCreateTool,
  TeamSpawnTool,
  TeamMessageTool,
  TeamBroadcastTool,
  TeamTasksTool,
  TeamClaimTool,
  TeamApprovePlanTool,
  TeamShutdownTool,
  TeamCleanupTool,
} from "../../src/tool/team"

/** The authoritative set of all team tool IDs from team.ts */
const ALL_TEAM_TOOL_IDS = [
  TeamCreateTool.id,
  TeamSpawnTool.id,
  TeamMessageTool.id,
  TeamBroadcastTool.id,
  TeamTasksTool.id,
  TeamClaimTool.id,
  TeamApprovePlanTool.id,
  TeamShutdownTool.id,
  TeamCleanupTool.id,
]

/** Read the task.ts source to extract the TEAM_TOOLS constant */
async function readTeamToolsFromSource() {
  const src = await Bun.file(
    new URL("../../src/tool/task.ts", import.meta.url).pathname,
  ).text()

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
    expect(tools.length).toBe(9)
    for (const id of ALL_TEAM_TOOL_IDS) {
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
    expect(tools.sort()).toEqual([...ALL_TEAM_TOOL_IDS].sort())
  })

  test("task.ts denies team tools in session permission rules", async () => {
    const src = await Bun.file(
      new URL("../../src/tool/task.ts", import.meta.url).pathname,
    ).text()

    // Verify the TEAM_TOOLS.map deny pattern exists in the permission array
    expect(src).toContain("...TEAM_TOOLS.map((t) => ({")
    expect(src).toContain('action: "deny" as const')

    // Verify it's inside the Session.create permission array (after todoread deny)
    const permissionSection = src.slice(
      src.indexOf("Session.create({"),
      src.indexOf("const msg = await MessageV2"),
    )
    expect(permissionSection).toContain("TEAM_TOOLS.map")
  })

  test("task.ts hides team tools from LLM tool list", async () => {
    const src = await Bun.file(
      new URL("../../src/tool/task.ts", import.meta.url).pathname,
    ).text()

    // Verify the tools map includes TEAM_TOOLS set to false
    const toolsSection = src.slice(
      src.indexOf("tools: {"),
      src.indexOf("parts: promptParts"),
    )
    expect(toolsSection).toContain("...Object.fromEntries(TEAM_TOOLS.map((t) => [t, false]))")
  })

  test("teammate system prompt documents relay pattern", async () => {
    const src = await Bun.file(
      new URL("../../src/tool/team.ts", import.meta.url).pathname,
    ).text()

    expect(src).toContain("SUBAGENT RELAY")
    expect(src).toContain("they CANNOT communicate with the team")
    expect(src).toContain("relaying any relevant findings")
  })
})
