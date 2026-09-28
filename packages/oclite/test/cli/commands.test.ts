import { describe, expect, test } from "bun:test"
import path from "path"
import { oclite } from "../lib/cli"
import { tmpdir } from "../lib/tmp"

async function setup() {
  const project = await tmpdir({ git: true })
  const home = await tmpdir()
  return {
    project,
    home,
    run: (args: string[], env?: Record<string, string>) => oclite(args, { cwd: project.path, home: home.path, env }),
    [Symbol.asyncDispose]: async () => {
      await project[Symbol.asyncDispose]()
      await home[Symbol.asyncDispose]()
    },
  }
}

describe("oclite commands (subprocess)", () => {
  test("--help exits 0 and lists the command groups", async () => {
    await using env = await setup()
    const result = await env.run(["--help"])
    expect(result.code).toBe(0)
    ;["mcp", "agents", "debug", "session", "--print", "--mcp-config", "--permission-mode"].forEach((word) =>
      expect(result.stdout).toContain(word),
    )
  })

  test("usage and config errors exit 2", async () => {
    await using env = await setup()
    const bogus = await env.run(["--bogus"])
    expect(bogus.code).toBe(2)
    const print = await env.run(["-p", "hello", "--agent", "nope"])
    expect(print.code).toBe(2)
    expect(print.stderr).toContain('unknown agent "nope"')
    const serve = await env.run(["mcp", "serve", "--transport", "http"])
    expect(serve.code).toBe(2)
    expect(serve.stderr).toContain("OCLITE_MCP_TOKEN")
  })

  test("agents list / show", async () => {
    await using env = await setup()
    await env.project.write(".oclite/agents/reviewer.md", "---\ndescription: Project reviewer\nmode: subagent\n---\nReview.")
    const list = await env.run(["agents", "list"])
    expect(list.code).toBe(0)
    ;["audit", "build", "code", "explore", "plan", "reviewer", "Project reviewer"].forEach((word) =>
      expect(list.stdout).toContain(word),
    )
    const json = await env.run(["agents", "list", "--output-format", "json"])
    expect(JSON.parse(json.stdout).map((agent: { name: string }) => agent.name)).toEqual([
      "audit",
      "build",
      "code",
      "explore",
      "plan",
      "reviewer",
    ])
    const show = await env.run(["agents", "show", "plan"])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain("read_only: true")
    const missing = await env.run(["agents", "show", "ghost"])
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('unknown agent "ghost"')
  })

  test("mcp add / list / get / remove across project and user scope", async () => {
    await using env = await setup()
    expect((await env.run(["mcp", "list"])).stdout).toContain("No MCP servers configured.")

    const local = await env.run(["mcp", "add", "fs", "-e", "API_TOKEN=secret-value-1", "--", "npx", "-y", "@mcp/fs", "/tmp"])
    expect(local.code).toBe(0)
    expect(await Bun.file(path.join(env.project.path, ".oclite/config.json")).json()).toEqual({
      mcp: {
        fs: { type: "local", command: ["npx", "-y", "@mcp/fs", "/tmp"], environment: { API_TOKEN: "secret-value-1" } },
      },
    })

    const remote = await env.run([
      ...["mcp", "add", "gh", "https://api.example.com/mcp", "--scope", "user"],
      ...["-H", "Authorization: Bearer abcdef123"],
    ])
    expect(remote.code).toBe(0)
    expect(await Bun.file(path.join(env.home.path, ".config/oclite/config.json")).json()).toEqual({
      mcp: { gh: { type: "remote", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer abcdef123" } } },
    })

    const duplicate = await env.run(["mcp", "add", "fs", "--", "other"])
    expect(duplicate.code).toBe(2)

    const list = await env.run(["mcp", "list"])
    expect(list.stdout).toContain("fs: npx -y @mcp/fs /tmp (local)")
    expect(list.stdout).toContain("gh: https://api.example.com/mcp (remote)")

    const get = await env.run(["mcp", "get", "gh"])
    expect(get.code).toBe(0)
    expect(JSON.parse(get.stdout).headers.Authorization).toBe("***")
    expect(get.stdout).not.toContain("abcdef123")
    expect((await env.run(["mcp", "get", "fs"])).stdout).not.toContain("secret-value-1")

    expect((await env.run(["mcp", "remove", "gh"])).code).toBe(0)
    expect(await Bun.file(path.join(env.home.path, ".config/oclite/config.json")).json()).toEqual({ mcp: {} })
    const again = await env.run(["mcp", "remove", "gh"])
    expect(again.code).toBe(2)
    expect((await env.run(["mcp", "get", "gh"])).code).toBe(2)
  })

  test("--mcp-config (Claude shape) and {env:} substitution reach mcp list", async () => {
    await using env = await setup()
    await env.project.write(
      "claude.json",
      JSON.stringify({ mcpServers: { docs: { type: "http", url: "{env:DOCS_URL}" }, fs: { command: "node", args: ["s.js"] } } }),
    )
    await env.project.write(".oclite/config.json", JSON.stringify({ mcp: { mine: { type: "local", command: ["mine"] } } }))
    const result = await env.run(["mcp", "list", "--mcp-config", "claude.json"], { DOCS_URL: "https://docs.example.com/mcp" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("docs: https://docs.example.com/mcp (remote)")
    expect(result.stdout).toContain("fs: node s.js (local)")
    expect(result.stdout).toContain("mine: mine (local)")
    const strict = await env.run(["mcp", "list", "--mcp-config", "claude.json", "--strict-mcp-config"])
    expect(strict.stdout).not.toContain("mine")
  })

  test("a bad remote entry with an Authorization header exits 2 without printing the token", async () => {
    await using env = await setup()
    await env.project.write(
      ".oclite/config.json",
      JSON.stringify({ mcp: { gh: { type: "http", url: "https://x.example.com", headers: { Authorization: "Bearer sk-live-TOKEN-42" } } } }),
    )
    const result = await env.run(["mcp", "list"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(".oclite")
    expect(result.stderr + result.stdout).not.toContain("sk-live-TOKEN-42")
  })

  test("mcp list/get hide URL credentials, secret query values and secret flag values", async () => {
    await using env = await setup()
    await env.project.write(
      ".oclite/config.json",
      JSON.stringify({
        mcp: {
          remote: { type: "remote", url: "https://bob:hunter2pw@mcp.example.com/mcp?api_key=KEY123456&region=eu" },
          fs: { type: "local", command: ["server", "--token", "abc123xyz", "--api-key=zzz999qq", "--password", "pw", "--verbose"] },
        },
      }),
    )
    const list = await env.run(["mcp", "list"])
    expect(list.code).toBe(0)
    ;["hunter2pw", "KEY123456", "abc123xyz", "zzz999qq", " pw "].forEach((secret) => expect(list.stdout).not.toContain(secret))
    expect(list.stdout).toContain("mcp.example.com/mcp")
    expect(list.stdout).toContain("region=eu")
    expect(list.stdout).toContain("--verbose")
    const get = await env.run(["mcp", "get", "fs"])
    ;["abc123xyz", "zzz999qq"].forEach((secret) => expect(get.stdout).not.toContain(secret))
  })

  test("unparsable config file is reported with its path by mcp add", async () => {
    await using env = await setup()
    await env.project.write(".oclite/config.json", "{ broken")
    const result = await env.run(["mcp", "add", "x", "--", "cmd"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(path.join(env.project.path, ".oclite", "config.json"))
  })

  test("invalid config exits 2 with the file path", async () => {
    await using env = await setup()
    await env.project.write(".oclite/config.json", JSON.stringify({ permission_timeout_ms: "soon" }))
    const result = await env.run(["agents", "list"])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(path.join(env.project.path, ".oclite", "config.json"))
  })
})
