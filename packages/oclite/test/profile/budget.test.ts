// Fixed-overhead budgets (SPEC primary constraint #1) via `oclite debug prompt --tokens --check` against the fake,
// whose prompt_tokens are deterministic (ceil(chars/4) of the rendered request). Numbers are recorded in docs/PERF.md.
import { describe, expect, test } from "bun:test"
import { oclite } from "../lib/cli"
import { reply, startLocalServer } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"

const PINS = {
  usage_in_stream: true, reasoning_field: "none", think_tags: false, tools_native: true, prefix_cache: true, tokenize: false,
  accepts: { chat_template_kwargs: true, prompt_cache_key: true, reasoning_effort: true, parallel_tool_calls: true },
}

async function setup(capabilities: Record<string, unknown> = PINS) {
  const server = await startLocalServer({})
  const project = await tmpdir({ git: true })
  const home = await tmpdir()
  await project.write(".git/HEAD", "ref: refs/heads/main\n")
  await project.write(".oclite/config.json", JSON.stringify({
    model: "local/test-model",
    provider: { local: { npm: "@ai-sdk/openai-compatible", options: { baseURL: server.url } } },
    servers: { [server.url]: { context_window: 32768, capabilities } },
  }))
  return {
    server, project,
    run: (args: string[]) => oclite(args, { cwd: project.path, home: home.path }),
    [Symbol.asyncDispose]: async () => {
      await server.stop()
      await project[Symbol.asyncDispose]()
      await home[Symbol.asyncDispose]()
    },
  }
}

type Report = { profile: string; budget: number; fixed: number; estimated: boolean; over: boolean; system_chars: number; tools: Array<{ name: string; description: number; schema: number }> }

describe("debug prompt --tokens --check", () => {
  test.each<[string, number, string[]]>([
    ["local", 1200, ["bash", "edit", "glob", "grep", "read", "write"]],
    ["local-min", 600, ["bash", "edit", "grep", "read"]],
    // The real registry: `question` is left out by design (tools/extra.ts), `task` arrives with sub-agents in phase 5.
    ["default", 7300, ["bash", "edit", "glob", "grep", "read", "skill", "todowrite", "webfetch", "write"]],
  ])("%s profile stays within %d tok", async (profile, budget, tools) => {
    await using env = await setup()
    const result = await env.run(["debug", "prompt", "--tokens", "--check", "--profile", profile, "--output-format", "json"])
    expect(result.stderr).toBe("")
    expect(result.code).toBe(0)
    const report: Report = JSON.parse(result.stdout)
    console.log(`PERF ${profile}: fixed=${report.fixed} tok, system=${report.system_chars} chars, tools=${JSON.stringify(report.tools)}`)
    expect(report).toMatchObject({ profile, budget, estimated: false, over: false })
    expect(report.tools.map((tool) => tool.name)).toEqual(tools)
    expect(report.fixed).toBeGreaterThan(0)
    expect(report.fixed).toBeLessThanOrEqual(budget)
    // Server-reported: A (system + tools + ".") minus B (".") equals the fake's chars/4 of the fixed part, ±1 rounding.
    const [a, b] = env.server.chats().map((item) => item.body!)
    expect(a!.max_tokens).toBe(1)
    expect(b!.tools).toBeUndefined()
    expect(b!.messages!.some((item) => item.role === "system")).toBe(false)
  })

  test("--check exits 1 when over budget (with or without --tokens)", async () => {
    await using env = await setup()
    await env.project.write(".oclite/agents/build.md", `---\ndescription: bloated\nmode: primary\n---\n${"Be careful. ".repeat(600)}`)
    const over = await env.run(["debug", "prompt", "--tokens", "--check", "--profile", "local", "--output-format", "json"])
    expect(over.code).toBe(1)
    expect(JSON.parse(over.stdout)).toMatchObject({ over: true, estimated: false })
    const estimate = await env.run(["debug", "prompt", "--check", "--profile", "local"])
    expect(estimate.code).toBe(1)
    expect(estimate.stdout).toMatch(/over budget: \d+ > 1200/)
    const unchecked = await env.run(["debug", "prompt", "--profile", "local"])
    expect(unchecked.code).toBe(0)
  })

  test("text output: prints the system prompt, per-tool chars and the server-reported number", async () => {
    await using env = await setup()
    const result = await env.run(["debug", "prompt", "--tokens", "--profile", "local"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("You are oclite")
    expect(result.stdout).toMatch(/read\s+description\s+\d+ chars · schema\s+\d+ chars/)
    expect(result.stdout).toMatch(/fixed overhead: \d+ tok \(server-reported\)/)
  })

  test("usage_in_stream=false: the number is labelled est.", async () => {
    await using env = await setup({ ...PINS, usage_in_stream: false })
    env.server.set({ usage_in_stream: false })
    const result = await env.run(["debug", "prompt", "--tokens", "--profile", "local"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/fixed overhead: \d+ tok \(est\.\)/)
  })

  test("auto profile: loopback openai-compatible → local; prefix_cache=false → local-min", async () => {
    await using env = await setup()
    expect(JSON.parse((await env.run(["debug", "prompt", "--output-format", "json"])).stdout).profile).toBe("local")
    await using nocache = await setup({ ...PINS, prefix_cache: false })
    expect(JSON.parse((await nocache.run(["debug", "prompt", "--output-format", "json"])).stdout).profile).toBe("local-min")
  })
})

describe("debug server", () => {
  test("prints every capability with its source, never unknown; --reprobe re-runs the probe", async () => {
    await using env = await setup({})
    const probeReply = [reply.reasoning("hm"), reply.tool_call({ name: "probe", args: { x: 1 } })]
    env.server.queue(probeReply, probeReply, probeReply, probeReply)
    const result = await env.run(["debug", "server"])
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain("unknown")
    ;["context_window", "usage_in_stream", "reasoning_field", "think_tags", "tools_native", "accepts", "prefix_cache", "concurrency", "tokenize", "no_think_suffix"]
      .forEach((field) => expect(result.stdout).toMatch(new RegExp(`^${field}\\s+.+\\((probe|config|default|static|error-400)\\)$`, "m")))
    expect(result.stdout).toMatch(/^context_window\s+32768\s+\(config\)$/m)
    expect(env.server.requests.length).toBeLessThanOrEqual(3)
    const probed = env.server.chats().length
    await env.run(["debug", "server"])
    expect(env.server.chats().length).toBe(probed)
    await env.run(["debug", "server", "--reprobe"])
    expect(env.server.chats().length).toBeGreaterThan(probed)
  })

  test("hosted anthropic: STATIC record, no requests, no unknown", async () => {
    await using env = await setup()
    const result = await env.run(["debug", "server", "--model", "anthropic/claude-sonnet-5"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("(static)")
    expect(result.stdout).not.toContain("unknown")
    expect(env.server.requests.length).toBe(0)
  })
})
