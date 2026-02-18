import { describe, expect, test } from "bun:test"
import { MCP } from "../../src/mcp/index"

describe("mcp aliases", () => {
  test("maps unique tool names to full tool ids", () => {
    const result = MCP.aliases([
      { client: "gh_grep", name: "searchGitHub" },
      { client: "context7", name: "query-docs" },
    ])

    expect(result).toEqual({
      searchGitHub: "gh_grep_searchGitHub",
      "query-docs": "context7_query-docs",
    })
  })

  test("drops ambiguous aliases when multiple servers expose same tool name", () => {
    const result = MCP.aliases([
      { client: "gh_grep", name: "search" },
      { client: "context7", name: "search" },
    ])

    expect(result.search).toBeUndefined()
  })

  test("sanitizes client and tool names", () => {
    const result = MCP.aliases([{ client: "gh.grep", name: "search docs" }])

    expect(result).toEqual({
      search_docs: "gh_grep_search_docs",
    })
  })
})
