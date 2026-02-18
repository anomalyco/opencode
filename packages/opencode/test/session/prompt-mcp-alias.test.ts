import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import type { Tool as AITool } from "ai"

function sampleTool(label: string) {
  return {
    description: label,
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({ output: label }),
  } as unknown as AITool
}

describe("session prompt mcp alias merge", () => {
  test("adds aliases when canonical tools exist", () => {
    const key = sampleTool("gh")
    const tools = {
      gh_grep_searchGitHub: key,
    } as Record<string, AITool>

    SessionPrompt.mergeToolAliases(tools, {
      searchGitHub: "gh_grep_searchGitHub",
    })

    expect(tools.searchGitHub).toBe(key)
  })

  test("does not override existing tools and ignores missing canonical targets", () => {
    const existing = sampleTool("bash")
    const tools = {
      bash: existing,
      gh_grep_searchGitHub: sampleTool("gh"),
    } as Record<string, AITool>

    SessionPrompt.mergeToolAliases(tools, {
      bash: "gh_grep_searchGitHub",
      searchGitHub: "missing_tool",
    })

    expect(tools.bash).toBe(existing)
    expect(tools.searchGitHub).toBeUndefined()
  })
})
