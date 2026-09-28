import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { AgentDef } from "../../src/contract"
import { compose } from "../../src/cli/debug"
import { descriptions, harnessPrompt, PROFILES, select } from "../../src/profile/profiles"
import TOOLS_LOCAL from "../../src/profile/tools.local.json"
import TOOLS_LOCAL_MIN from "../../src/profile/tools.local-min.json"
import { startLocalServer } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"
import { config, pinned, withGateway } from "../llm/gateway"

// The gateway's probe cache lives under dataDir(), which reads XDG_DATA_HOME at call time.
const data = await tmpdir()
const previous = process.env.XDG_DATA_HOME
beforeAll(() => {
  process.env.XDG_DATA_HOME = data.path
})
afterAll(async () => {
  process.env.XDG_DATA_HOME = previous
  await data[Symbol.asyncDispose]()
})

const TOOLS = ["bash", "edit", "glob", "grep", "question", "read", "skill", "task", "todowrite", "tool_search", "webfetch", "write"]
const agent: AgentDef = {
  name: "build", mode: "primary", prompt: "You are the build agent.", permission: [], options: {}, source: "builtin",
  transport: "in-process", max_depth: 2, read_only: false, thinking: "auto", tools: ["todowrite", "not-a-tool"],
}

async function handles() {
  await using server = await startLocalServer({})
  const cfg = config(server, { pins: pinned() })
  return withGateway(cfg, (gateway) =>
    Effect.all({ local: gateway.resolve("local/test-model"), hosted: gateway.resolve("anthropic/claude-sonnet-5") }),
  ).then((result) => ({ ...result, cfg }))
}

describe("profiles", () => {
  test("table matches ARCHITECTURE §9 (default budget 7300 per lead decision)", () => {
    expect(PROFILES.local).toMatchObject({ promptMaxChars: 600, descriptionMaxChars: 300, mcp: "deferred", instructionCapChars: 2000, title: false, stubAfterTurns: 6, compactAt: 0.75, budgetTokens: 1200 })
    expect(PROFILES["local-min"]).toMatchObject({ promptMaxChars: 300, descriptionMaxChars: 150, instructionCapChars: 1000, stubAfterTurns: 3, compactAt: 0.6, budgetTokens: 600 })
    expect(PROFILES.default).toMatchObject({ promptMaxChars: undefined, descriptionMaxChars: undefined, mcp: "all", title: true, budgetTokens: 7300 })
    expect(PROFILES.local.optionalTools).toEqual(["question", "skill", "task", "todowrite", "webfetch"])
    Object.values(PROFILES).forEach((profile) => expect([...profile.tools]).toEqual([...profile.tools].sort()))
  })

  test("rewritten descriptions exist for every tool and fit the caps (≤300 local, ≤150 local-min)", () => {
    expect(Object.keys(TOOLS_LOCAL).sort()).toEqual(TOOLS)
    expect(Object.keys(TOOLS_LOCAL_MIN).sort()).toEqual(TOOLS)
    Object.values(TOOLS_LOCAL).forEach((text) => expect(text.length).toBeLessThanOrEqual(300))
    Object.values(TOOLS_LOCAL_MIN).forEach((text) => expect(text.length).toBeLessThanOrEqual(150))
    expect(descriptions(PROFILES.local, "read")).toBe(TOOLS_LOCAL.read)
    expect(descriptions(PROFILES.default, "read")).toBeUndefined()
    expect(descriptions(PROFILES.local, "mcp__x__y")).toBeUndefined()
  })

  test("harness prompts: local ≤ 600, local-min ≤ 300 chars; default is opencode's per-model prompt", async () => {
    const { local, hosted } = await handles()
    expect(harnessPrompt(PROFILES.local, local).length).toBeLessThanOrEqual(600)
    expect(harnessPrompt(PROFILES["local-min"], local).length).toBeLessThanOrEqual(300)
    expect(harnessPrompt(PROFILES.default, hosted)).toContain("You are OpenCode")
    expect(harnessPrompt(PROFILES.default, hosted).length).toBe(8212) // anthropic.txt for a claude model id
    expect(harnessPrompt(PROFILES.default, local).length).toBe(8528) // default.txt for an unknown model id
  })

  test("select: explicit wins; loopback compatible → local; hosted → default (never local-min)", async () => {
    const { local, hosted } = await handles()
    expect(select({ handle: local }).name).toBe("local")
    expect(select({ handle: hosted }).name).toBe("default")
    expect(select({ handle: { ...hosted, capabilities: { ...hosted.capabilities, prefix_cache: false } } }).name).toBe("default")
    expect(select({ handle: hosted, explicit: "local-min" }).name).toBe("local-min")
  })
})

describe("byte-stable composition", () => {
  test("same system + tools bytes on every call; tools sorted; env block carries the date only", async () => {
    await using project = await tmpdir({ git: true })
    await project.write(".git/HEAD", "ref: refs/heads/feature-x\n")
    const { local, cfg } = await handles()
    const at = { ...cfg, cwd: project.path, projectRoot: project.path }
    const a = await compose(at, local, PROFILES.local, agent)
    await Bun.sleep(5)
    const b = await compose(at, local, PROFILES.local, agent)
    expect(a.system).toBe(b.system)
    expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools))
    // Optional tools come only from AgentDef.tools ∩ profile.optionalTools, and the list stays sorted.
    expect(a.tools.map((tool) => tool.name)).toEqual(["bash", "edit", "glob", "grep", "read", "todowrite", "write"])
    const env = a.system.slice(a.system.indexOf("<env>"))
    expect(env).toContain(`date: ${new Date().toISOString().slice(0, 10)}`)
    expect(env).toContain("git branch: feature-x")
    expect(env).not.toMatch(/\d{1,2}:\d{2}/)
    expect(a.system.indexOf("You are oclite")).toBe(0)
    expect(a.system.indexOf("You are the build agent.")).toBeLessThan(a.system.indexOf("<env>"))
  })
})
