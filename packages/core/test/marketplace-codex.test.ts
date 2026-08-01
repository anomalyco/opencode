import { describe, expect, test } from "bun:test"
import { adaptCodexMarketplace } from "../src/marketplace-codex"

describe("Codex Marketplace adapter", () => {
  test("adapts a repo-local plugin manifest, skills, and MCP servers", async () => {
    const values = new Map<string, unknown>([
      [
        "file:///repo/plugins/review/.codex-plugin/plugin.json",
        {
          name: "review",
          version: "1.2.3",
          description: "Review changes",
          skills: "./skills/",
          mcpServers: "./.mcp.json",
          interface: { displayName: "Code Review", capabilities: ["Read"] },
        },
      ],
      ["file:///repo/plugins/review/.mcp.json", { tools: { command: "bun", args: ["$PLUGIN_ROOT/server.ts"] } }],
    ])
    const fetcher = async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      const value = values.get(url)
      return value === undefined ? new Response("not found", { status: 404 }) : Response.json(value)
    }
    const catalog = await adaptCodexMarketplace(
      {
        name: "team",
        interface: { displayName: "Team plugins" },
        plugins: [
          {
            name: "review",
            source: { source: "local", path: "./plugins/review" },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: "Developer tools",
          },
        ],
      },
      {
        fetcher,
        source: { id: "team", name: "Team", url: "file:///repo/.agents/plugins/marketplace.json" },
        catalogURL: "file:///repo/.agents/plugins/marketplace.json",
      },
    )

    expect(catalog.name).toBe("Team plugins")
    expect(catalog.items[0]).toMatchObject({
      id: "review",
      name: "Code Review",
      version: "1.2.3",
      install: {
        skills: { urls: ["file:///repo/plugins/review/skills/"] },
        mcp: { tools: { type: "local", command: ["bun", "file:///repo/plugins/review/server.ts"] } },
      },
    })
  })

  test("resolves GitLab repositories through immutable raw URLs", async () => {
    const requested: string[] = []
    const catalog = await adaptCodexMarketplace(
      {
        name: "team",
        plugins: [
          {
            name: "review",
            source: {
              source: "git-subdir",
              url: "https://gitlab.com/acme/plugins.git",
              sha: "0123456789abcdef",
              path: "./review",
            },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: "Developer tools",
          },
        ],
      },
      {
        fetcher: async (input) => {
          requested.push(input instanceof Request ? input.url : input instanceof URL ? input.href : input)
          return Response.json({ name: "review", version: "1.0.0", description: "Review changes" })
        },
        source: { id: "team", name: "Team", url: "https://example.com/marketplace.json" },
        catalogURL: "https://example.com/marketplace.json",
      },
    )

    expect(requested).toEqual([
      "https://gitlab.com/acme/plugins/-/raw/0123456789abcdef/review/.codex-plugin/plugin.json",
    ])
    expect(catalog.items[0]?.install.skills?.urls).toEqual([
      "https://gitlab.com/acme/plugins/-/raw/0123456789abcdef/review/skills/",
    ])
  })

  test("rejects a partially unresolved catalog instead of silently omitting plugins", async () => {
    expect(
      adaptCodexMarketplace(
        {
          name: "team",
          plugins: [
            {
              name: "review",
              source: "./review",
              policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
              category: "Developer tools",
            },
            {
              name: "private",
              source: { source: "url", url: "ssh://git@example.com/private.git" },
              policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
              category: "Developer tools",
            },
          ],
        },
        {
          fetcher: async () => Response.json({ name: "review", version: "1.0.0", description: "Review changes" }),
          source: { id: "team", name: "Team", url: "https://example.com/.agents/plugins/marketplace.json" },
          catalogURL: "https://example.com/.agents/plugins/marketplace.json",
        },
      ),
    ).rejects.toThrow("Unsupported Codex plugin source for private")
  })
})
