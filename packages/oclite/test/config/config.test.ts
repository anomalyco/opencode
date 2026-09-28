import { describe, expect, test } from "bun:test"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import type { CliArgs } from "../../src/cli/args"
import { load } from "../../src/config/config"
import { ConfigError } from "../../src/contract"
import { tmpdir } from "../lib/tmp"

const base: CliArgs = {
  outputFormat: "text",
  mcpConfig: [],
  strictMcpConfig: false,
  allowedTools: [],
  disallowedTools: [],
  continue: false,
  noThinking: false,
}

// A git project plus a separate home whose config dir is `<home>/.config/oclite`.
async function setup(files: { user?: unknown; project?: unknown; extra?: Record<string, string> } = {}) {
  const project = await tmpdir({ git: true, files: files.extra })
  const home = await tmpdir()
  if (files.user !== undefined) await home.write(".config/oclite/config.json", JSON.stringify(files.user))
  if (files.project !== undefined) await project.write(".oclite/config.json", JSON.stringify(files.project))
  return {
    project,
    home,
    load: (args: Partial<CliArgs> = {}) =>
      Effect.runPromise(
        load({ ...base, ...args }, { cwd: project.path, home: home.path, configDir: path.join(home.path, ".config", "oclite") }),
      ),
    fail: async (args: Partial<CliArgs> = {}) => {
      const exit = await Effect.runPromiseExit(
        load({ ...base, ...args }, { cwd: project.path, home: home.path, configDir: path.join(home.path, ".config", "oclite") }),
      )
      if (Exit.isSuccess(exit)) throw new Error("expected failure")
      return Cause.squash(exit.cause)
    },
    [Symbol.asyncDispose]: async () => {
      await project[Symbol.asyncDispose]()
      await home[Symbol.asyncDispose]()
    },
  }
}

describe("config", () => {
  test("defaults", async () => {
    await using env = await setup()
    const cfg = await env.load()
    expect(cfg).toMatchObject({
      cwd: env.project.path,
      projectRoot: env.project.path,
      model: "anthropic/claude-sonnet-5",
      default_agent: "build",
      permissionMode: "default",
      permission_timeout_ms: 300000,
      subagent: { max_depth: 2, max_concurrent: 4 },
      showThinking: true,
      mcp: {},
      permission: [],
      cliRules: [],
      instructions: [],
      hooks: { PreToolUse: [], PostToolUse: [], Stop: [] },
    })
    expect(Object.keys(cfg.agents).sort()).toEqual(["audit", "build", "code", "explore", "plan"])
  })

  test("precedence: defaults < user < project < flags; instructions concatenate; objects deep-merge", async () => {
    await using env = await setup({
      user: {
        model: "user/a",
        small_model: "user/small",
        instructions: ["USER.md"],
        permission: { bash: { "git *": "allow" }, edit: "ask" },
        provider: { local: { options: { baseURL: "http://127.0.0.1:8000/v1" } } },
      },
      project: {
        model: "project/b",
        instructions: ["docs/STYLE.md"],
        permission: { edit: "deny" },
        provider: { local: { models: { qwen: { limit: { context: 32768 } } } } },
        agent: { build: { steps: 5 } },
      },
    })
    const cfg = await env.load()
    expect(cfg.model).toBe("project/b")
    expect(cfg.small_model).toBe("user/small")
    expect(cfg.instructions).toEqual([
      path.join(env.home.path, ".config", "oclite", "USER.md"),
      path.join(env.project.path, "docs", "STYLE.md"),
    ])
    expect(cfg.permission).toEqual([
      { permission: "bash", pattern: "git *", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ])
    expect(cfg.provider.local).toEqual({
      options: { baseURL: "http://127.0.0.1:8000/v1" },
      models: { qwen: { limit: { context: 32768 } } },
    })
    expect(cfg.agents.build.steps).toBe(5)
    expect(cfg.agents.build.prompt).toContain("build agent")
    expect(cfg.agents.explore.model).toBe("user/small")
    expect((await env.load({ model: "flag/c", agent: "plan", profile: "local" })).model).toBe("flag/c")
  })

  test("{env:} and {file:} substitution", async () => {
    await using env = await setup({
      project: { small_model: "{env:HOME}", model: "{file:model.txt}" },
      extra: { ".oclite/model.txt": "local/from-file\n" },
    })
    const cfg = await env.load()
    expect(cfg.small_model).toBe(process.env.HOME ?? "")
    expect(cfg.model).toBe("local/from-file")
  })

  test("JSONC comments and trailing commas are accepted", async () => {
    await using env = await setup()
    await env.project.write(".oclite/config.json", '{\n  // local model\n  "model": "local/x",\n}\n')
    expect((await env.load()).model).toBe("local/x")
  })

  test("--mcp-config imports Claude mcpServers and oclite {mcp}, file or inline", async () => {
    await using env = await setup({
      extra: {
        "claude.json": JSON.stringify({
          mcpServers: {
            fs: { command: "node", args: ["server.js"], env: { ROOT: "/tmp" } },
            gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer t0ken-value" } },
          },
        }),
      },
    })
    const cfg = await env.load({
      mcpConfig: ["claude.json", JSON.stringify({ mcp: { docs: { type: "remote", url: "https://docs.example.com/mcp" } } })],
    })
    expect(cfg.mcp).toEqual({
      fs: { type: "local", command: ["node", "server.js"], environment: { ROOT: "/tmp" } },
      gh: { type: "remote", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer t0ken-value" } },
      docs: { type: "remote", url: "https://docs.example.com/mcp" },
    })
  })

  test("--strict-mcp-config drops user and project mcp but keeps --mcp-config", async () => {
    await using env = await setup({
      user: { mcp: { a: { type: "local", command: ["a"] } } },
      project: { mcp: { b: { type: "local", command: ["b"] } } },
      extra: { "only.json": JSON.stringify({ mcp: { c: { type: "local", command: ["c"] } } }) },
    })
    expect(Object.keys((await env.load({ mcpConfig: ["only.json"] })).mcp).sort()).toEqual(["a", "b", "c"])
    expect(Object.keys((await env.load({ mcpConfig: ["only.json"], strictMcpConfig: true })).mcp)).toEqual(["c"])
  })

  test("a later layer replaces an MCP server entry instead of merging fields", async () => {
    await using env = await setup({
      user: { mcp: { a: { type: "local", command: ["a"], environment: { X: "1" } } } },
      project: { mcp: { a: { type: "remote", url: "https://a.example.com" } } },
    })
    expect((await env.load()).mcp.a).toEqual({ type: "remote", url: "https://a.example.com" })
  })

  test("hooks in oclite and Claude shapes", async () => {
    await using env = await setup({
      project: {
        hooks: {
          PreToolUse: [
            { matcher: "bash", command: "./check.sh", timeout: 5000 },
            {
              matcher: "Edit|Write",
              hooks: [
                { type: "command", command: "./fmt.sh", timeout: 3 },
                { type: "prompt", command: "not a shell command" },
                { type: "command", command: "./lint.sh" },
              ],
            },
          ],
          Stop: [{ command: "./done.sh" }],
        },
      },
    })
    expect((await env.load()).hooks).toEqual({
      PreToolUse: [
        { matcher: "bash", command: "./check.sh", timeout_ms: 5000 },
        { matcher: "Edit|Write", command: "./fmt.sh", timeout_ms: 3000 },
        { matcher: "Edit|Write", command: "./lint.sh", timeout_ms: 10000 },
      ],
      PostToolUse: [],
      Stop: [{ matcher: "*", command: "./done.sh", timeout_ms: 10000 }],
    })
  })

  test("servers pins keyed by base URL without trailing slash", async () => {
    await using env = await setup({
      project: {
        servers: {
          "http://127.0.0.1:8000/v1/": { capabilities: { tools_native: false, accepts: { prompt_cache_key: false } }, concurrency: 1 },
        },
      },
    })
    expect((await env.load()).servers).toEqual({
      "http://127.0.0.1:8000/v1": { capabilities: { tools_native: false, accepts: { prompt_cache_key: false } }, concurrency: 1 },
    })
  })

  test("--allowed-tools / --disallowed-tools become cliRules (allow then deny), Claude names mapped", async () => {
    await using env = await setup()
    const cfg = await env.load({
      allowedTools: ["Read,bash(git *)", "mcp__github__*"],
      disallowedTools: ["Bash(rm:*)"],
    })
    expect(cfg.cliRules).toEqual([
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "git *", action: "allow" },
      { permission: "mcp__github__*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "rm*", action: "deny" },
    ])
  })

  test("flags: permission mode, thinking, append prompt, max turns", async () => {
    await using env = await setup()
    expect(
      await env.load({ permissionMode: "plan", thinking: "on", noThinking: true, appendSystemPrompt: "x", maxTurns: 3 }),
    ).toMatchObject({ permissionMode: "plan", thinking: "on", showThinking: false, appendSystemPrompt: "x", maxTurns: 3 })
  })

  test("errors are ConfigError naming the file", async () => {
    await using env = await setup({ project: { model: 42 } })
    const error = await env.fail()
    expect(error).toBeInstanceOf(ConfigError)
    expect(String(error)).toContain(path.join(env.project.path, ".oclite", "config.json"))
  })

  test("decode errors never include the offending value", async () => {
    await using env = await setup({
      project: { mcp: { gh: { type: "http", url: "https://x.example.com", headers: { Authorization: "Bearer sk-live-SECRET-1" } } } },
    })
    const message = String(await env.fail())
    expect(message).toContain("at mcp.gh")
    expect(message).not.toContain("sk-live-SECRET-1")
  })

  test("invalid JSON, missing --mcp-config file and unknown agent are ConfigErrors", async () => {
    await using env = await setup()
    await env.project.write(".oclite/config.json", "{ nope")
    expect(await env.fail()).toBeInstanceOf(ConfigError)
    await env.project.write(".oclite/config.json", "{}")
    expect(await env.fail({ mcpConfig: ["missing.json"] })).toBeInstanceOf(ConfigError)
    expect(String(await env.fail({ agent: "ghost" }))).toContain('unknown agent "ghost"')
  })
})
