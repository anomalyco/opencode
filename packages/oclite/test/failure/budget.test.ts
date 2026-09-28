// Phase 7: headless fixed-overhead budgets per profile (`debug prompt --tokens --check`, server-reported by the
// fake as ceil(chars/4)), with and without the MCP fixture configured.
import { describe, expect, test } from "bun:test"
import { oclite } from "../lib/cli"
import { startLocalServer } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"
import { fixture, TRUST } from "./lib"

const PINS = {
  usage_in_stream: true, reasoning_field: "none", think_tags: false, tools_native: true, prefix_cache: true, tokenize: false,
  accepts: { chat_template_kwargs: true, prompt_cache_key: true, reasoning_effort: true, parallel_tool_calls: true },
}
const BUDGET: Record<string, number> = { local: 1200, "local-min": 600, default: 7300 }

async function check(profile: string, mcp: boolean) {
  await using server = await startLocalServer()
  await using project = await tmpdir({ git: true })
  await using home = await tmpdir()
  await project.write(".git/HEAD", "ref: refs/heads/main\n")
  await project.write(
    ".oclite/config.json",
    JSON.stringify({
      model: "local/test-model",
      provider: { local: { npm: "@ai-sdk/openai-compatible", options: { baseURL: server.url } } },
      servers: { [server.url]: { context_window: 32768, capabilities: PINS } },
      ...(mcp ? { mcp: { fixture: { type: "local", command: [process.execPath, fixture] } } } : {}),
    }),
  )
  const result = await oclite(["debug", "prompt", "--tokens", "--check", "--profile", profile, "--output-format", "json"], {
    cwd: project.path,
    home: home.path,
    env: TRUST,
  })
  return { result, report: result.code === 0 || result.code === 1 ? JSON.parse(result.stdout) : undefined, chats: server.chats() }
}

describe("headless budget per profile", () => {
  test.each<[string, boolean]>([
    ["local", false],
    ["local-min", false],
    ["default", false],
    ["local", true],
    ["local-min", true],
  ])("%s (mcp fixture: %p) passes --check", async (profile, mcp) => {
    const out = await check(profile, mcp)
    expect(out.result.code).toBe(0)
    expect(out.report).toMatchObject({ profile, budget: BUDGET[profile], estimated: false, over: false })
    expect(out.report.fixed).toBeGreaterThan(0)
    expect(out.report.fixed).toBeLessThanOrEqual(BUDGET[profile]!)
    const names = (out.report.tools as Array<{ name: string }>).map((tool) => tool.name)
    // Local profiles defer MCP schemas behind tool_search, so the fixture adds one tool, never its six.
    expect(names.some((name) => name.startsWith("mcp__"))).toBe(false)
    if (mcp) expect(names).toContain("tool_search")
    if (!mcp) expect(names).not.toContain("tool_search")
    console.log(`PERF budget ${profile}${mcp ? "+mcp" : ""}: fixed=${out.report.fixed}/${BUDGET[profile]}`)
  }, 30_000)
})
