import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "../src/config.js"
import { ConfigAgent } from "../src/config/agent.js"
import { ConfigMCP } from "../src/config/mcp.js"
import { ConfigProvider } from "../src/config/provider.js"
import { Mcp } from "../src/mcp.js"
import { Provider } from "../src/provider.js"
import { AbsolutePath } from "../src/schema.js"
import { WebSearch } from "../src/websearch.js"

describe("Config.Entry", () => {
  test("round-trips canonical provider IDs without changing config keys", () => {
    const input = { providers: { "console-anthropic": { canonical: "anthropic" } } }
    const decoded = Schema.decodeUnknownSync(Config.Info)(input)
    expect(decoded.providers?.["console-anthropic"]?.canonical).toBe(Provider.ID.anthropic)
    expect(Schema.encodeSync(Config.Info)(decoded)).toEqual(input)
    expect(() => Schema.decodeUnknownSync(Config.Info)({ providers: { custom: { canonical: 1 } } })).toThrow()
  })

  test("accepts disabled, fixed, auto, and legacy random web search selection", () => {
    const decode = Schema.decodeUnknownSync(Config.Info)

    expect(decode({ websearch: false }).websearch).toBe(false)
    expect(decode({ websearch: { provider: "exa" } }).websearch).toEqual({ provider: WebSearch.ID.make("exa") })
    expect(decode({ websearch: { provider: "auto" } }).websearch).toEqual({ provider: "auto" })
    expect(decode({ websearch: { provider: "random" } }).websearch).toEqual({ provider: "random" })
  })

  test("round-trips every configuration entry type", () => {
    const entries = [
      new Config.Document({
        type: "document",
        path: AbsolutePath.make("/project/opencode.json"),
        info: new Config.Info({
          permissions: [
            { action: "shell", resource: "*", effect: "ask" },
            { action: "shell", resource: "git status", effect: "allow" },
          ],
        }),
      }),
      new Config.Document({ type: "document", info: new Config.Info({ shell: "/bin/zsh" }) }),
      new Config.Directory({ type: "directory", path: AbsolutePath.make("/project/.opencode") }),
      new Config.AgentsDirectory({ type: "agents", path: AbsolutePath.make("/project/.agents") }),
      new Config.ClaudeDirectory({ type: "claude", path: AbsolutePath.make("/project/.claude") }),
    ]

    const encoded = Schema.encodeSync(Schema.Array(Config.Entry))(entries)
    const decoded = Schema.decodeUnknownSync(Schema.Array(Config.Entry))(encoded)

    expect(decoded).toEqual(entries)
    expect(decoded[0]).toBeInstanceOf(Config.Document)
    expect(decoded[1]).not.toHaveProperty("path")
    expect(decoded.map((entry) => entry.type)).toEqual(["document", "document", "directory", "agents", "claude"])
    expect(decoded[0]?.type === "document" ? decoded[0].info.permissions : undefined).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git status", effect: "allow" },
    ])
  })

  test("has a stable public identifier", () => {
    expect(Config.Entry.ast.annotations?.identifier).toBe("Config.Entry")
  })

  test("omits undefined optional properties while encoding", () => {
    const entry = new Config.Document({
      type: "document",
      path: undefined,
      info: new Config.Info({
        default_agent: undefined,
        agents: { reviewer: new ConfigAgent.Info({ description: undefined }) },
        mcp: new ConfigMCP.Info({
          timeout: undefined,
          servers: {
            docs: new Mcp.RemoteConfig({
              type: "remote",
              url: "https://example.com/mcp",
              headers: undefined,
              oauth: new Mcp.OAuthConfig({ client_id: undefined }),
            }),
          },
        }),
        providers: { custom: new ConfigProvider.Info({ canonical: undefined, headers: undefined }) },
      }),
    })
    const encoded = Schema.encodeSync(Config.Entry)(entry)
    if (encoded.type !== "document") throw new Error("Expected a config document")

    expect(encoded).not.toHaveProperty("path")
    expect(encoded.info).not.toHaveProperty("default_agent")
    expect(encoded.info.agents?.reviewer).not.toHaveProperty("description")
    expect(encoded.info.mcp).not.toHaveProperty("timeout")
    const docs = encoded.info.mcp?.servers?.docs
    if (docs?.type !== "remote" || docs.oauth === false) throw new Error("Expected a remote MCP server")
    expect(docs).not.toHaveProperty("headers")
    expect(docs.oauth).not.toHaveProperty("client_id")
    expect(encoded.info.providers?.custom).not.toHaveProperty("headers")
    expect(encoded.info.providers?.custom).not.toHaveProperty("canonical")
  })
})
