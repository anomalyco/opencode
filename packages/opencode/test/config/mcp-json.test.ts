import { test, expect, describe } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("mcp.json support", () => {
  test("loads local MCP server from mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "test-local": {
                command: "npx",
                args: ["-y", "test-server"],
                env: {
                  API_KEY: "test-key",
                },
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp).toBeDefined()
        expect(config.mcp!["test-local"]).toEqual({
          type: "local",
          command: ["npx", "-y", "test-server"],
          environment: {
            API_KEY: "test-key",
          },
        })
      },
    })
  })

  test("loads remote MCP server from mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "test-remote": {
                url: "https://api.example.com/mcp",
                headers: {
                  Authorization: "Bearer token123",
                },
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp).toBeDefined()
        expect(config.mcp!["test-remote"]).toEqual({
          type: "remote",
          url: "https://api.example.com/mcp",
          headers: {
            Authorization: "Bearer token123",
          },
        })
      },
    })
  })

  test("normalizes ${env:VAR} syntax to {env:VAR}", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "test-env": {
                url: "https://api.example.com/mcp",
                headers: {
                  Authorization: "Bearer ${env:MY_TOKEN}",
                },
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp!["test-env"]).toEqual({
          type: "remote",
          url: "https://api.example.com/mcp",
          headers: {
            Authorization: "Bearer {env:MY_TOKEN}",
          },
        })
      },
    })
  })

  test("opencode.json mcp config takes priority over mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create mcp.json with a server
        await Bun.write(
          path.join(dir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "same-name": {
                command: "from-mcp-json",
                args: [],
              },
              "only-in-mcp-json": {
                command: "unique-server",
                args: [],
              },
            },
          }),
        )
        // Create opencode.json with the same server name
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: {
              "same-name": {
                type: "local",
                command: ["from-opencode-json"],
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        // opencode.json takes priority for same-named server
        expect(config.mcp!["same-name"]).toEqual({
          type: "local",
          command: ["from-opencode-json"],
        })
        // mcp.json servers still available if not overridden
        expect(config.mcp!["only-in-mcp-json"]).toEqual({
          type: "local",
          command: ["unique-server"],
        })
      },
    })
  })

  test("loads mcp.json from .opencode directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await Bun.write(path.join(opencodeDir, "package.json"), "{}")
        await Bun.write(
          path.join(opencodeDir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "from-opencode-dir": {
                command: "test-cmd",
                args: ["--flag"],
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp!["from-opencode-dir"]).toEqual({
          type: "local",
          command: ["test-cmd", "--flag"],
        })
      },
    })
  })

  test("loads mcp.json from .cursor directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const cursorDir = path.join(dir, ".cursor")
        await Bun.write(
          path.join(cursorDir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "from-cursor": {
                command: "cursor-server",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp!["from-cursor"]).toEqual({
          type: "local",
          command: ["cursor-server"],
        })
      },
    })
  })

  test("loads mcp.json from .claude directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const claudeDir = path.join(dir, ".claude")
        await Bun.write(
          path.join(claudeDir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              "from-claude": {
                command: "claude-server",
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp!["from-claude"]).toEqual({
          type: "local",
          command: ["claude-server"],
        })
      },
    })
  })

  test("handles empty mcp.json gracefully", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "mcp.json"), "{}")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        // Should not throw - may have global mcp.json servers loaded
        expect(true).toBe(true)
      },
    })
  })

  test("handles mcp.json with only mcpServers key but empty", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: {} }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        // Should not throw - may have global mcp.json servers loaded
        expect(true).toBe(true)
      },
    })
  })
})
