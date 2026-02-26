import { describe, expect, test } from "bun:test"
import { Discover } from "../../src/cache/discover"
import { Embed } from "../../src/cache/embed"
import type { Cache } from "../../src/cache/cache"

describe("cache.discover", () => {
  test("finds github PR tool in top results", async () => {
    const ids = [
      "github_create_pr",
      "read_file",
      "grep_search",
      "list_dir",
      "edit_file",
      "run_tests",
      "deploy_app",
      "open_issue",
      "archive_logs",
      "send_email",
      "weather_lookup",
    ]

    const descriptions = [
      "Create a pull request on GitHub",
      "Read local file content",
      "Search text in files",
      "List files in a directory",
      "Edit source code",
      "Run test suite",
      "Deploy application",
      "Open a ticket",
      "Archive logs",
      "Send email",
      "Lookup weather",
    ]

    const embeddings = Embed.tfidf(descriptions)
    const rows = ids.map(
      (id, i) =>
        ({
          id,
          name: id,
          description: descriptions[i],
          schema_json: "{}",
          embedding: embeddings[i],
          is_l1: 0,
          use_count: 0,
          registered: Date.now(),
        }) satisfies Cache.ToolRow,
    )

    const result = await Discover.tools("create github PR", 3, rows)
    expect(result[0]?.id).toBe("github_create_pr")
  })

  test("respects topK", async () => {
    const rows = [
      {
        id: "a",
        name: "a",
        description: "aaa",
        schema_json: "{}",
        embedding: Embed.tfidf(["aaa"])[0],
        is_l1: 0,
        use_count: 0,
        registered: Date.now(),
      } satisfies Cache.ToolRow,
      {
        id: "b",
        name: "b",
        description: "bbb",
        schema_json: "{}",
        embedding: Embed.tfidf(["bbb"])[0],
        is_l1: 0,
        use_count: 0,
        registered: Date.now(),
      } satisfies Cache.ToolRow,
    ]

    const result = await Discover.tools("a", 1, rows)
    expect(result.length).toBe(1)
  })

  test("returns empty for empty rows", async () => {
    expect(await Discover.tools("a", 5, [])).toEqual([])
  })
})
