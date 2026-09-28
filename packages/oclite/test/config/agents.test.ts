import { describe, expect, test } from "bun:test"
import path from "path"
import { Schema } from "effect"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { loadAgents } from "../../src/config/agents"
import { ConfigError } from "../../src/contract"
import { tmpdir } from "../lib/tmp"

const override = Schema.decodeUnknownSync(ConfigAgentV1.Info)

async function load(root: string, home: string, overrides: Record<string, ConfigAgentV1.Info> = {}) {
  return loadAgents({ projectRoot: root, cwd: root, home, overrides })
}

// opencode's evaluate semantics: last matching rule wins.
function decide(rules: PermissionV1.Ruleset, permission: string) {
  return rules.findLast((rule) => Wildcard.match(permission, rule.permission))?.action
}

describe("agents", () => {
  test("built-in roles", async () => {
    await using root = await tmpdir({ git: true })
    await using home = await tmpdir()
    const agents = await load(root.path, home.path)
    expect(
      Object.values(agents)
        .map((agent) => [agent.name, agent.mode, agent.read_only, agent.source])
        .sort(),
    ).toEqual([
      ["audit", "subagent", true, "builtin"],
      ["build", "primary", false, "builtin"],
      ["code", "subagent", false, "builtin"],
      ["explore", "subagent", true, "builtin"],
      ["plan", "primary", true, "builtin"],
    ])
    expect(agents.build).toMatchObject({ transport: "in-process", max_depth: 2, thinking: "auto", permission: [] })
    expect(agents.explore.prompt).toContain("800 words")
  })

  test(".claude/agents compat: tools list only restricts (no allow rules); model alias inherits", async () => {
    await using root = await tmpdir({
      git: true,
      files: {
        ".claude/agents/reviewer.md": [
          "---",
          "name: code-reviewer",
          "description: Reviews code",
          "tools: Read, Grep, MultiEdit, mcp__github__get_pr",
          "model: sonnet",
          "color: blue",
          "---",
          "Review carefully.",
        ].join("\n"),
        ".claude/agents/open.md": "---\ndescription: No tools field\nmodel: anthropic/claude-opus-5\n---\nAll tools.",
      },
    })
    await using home = await tmpdir()
    const agents = await load(root.path, home.path)
    const reviewer = agents["code-reviewer"]
    expect(reviewer).toMatchObject({ description: "Reviews code", prompt: "Review carefully.", mode: "all" })
    expect(reviewer.model).toBeUndefined()
    expect(reviewer.source).toBe(path.join(root.path, ".claude/agents/reviewer.md"))
    // Listing an MCP tool implies tool_search (deferred profiles reach MCP tools only through it).
    expect(reviewer.tools).toEqual(["read", "grep", "edit", "mcp__github__get_pr", "tool_search"])
    expect(reviewer.permission.some((rule) => rule.action === "allow")).toBe(false)
    // listed built-ins fall through to the normal default (no agent rule)
    expect(decide(reviewer.permission, "read")).toBeUndefined()
    expect(decide(reviewer.permission, "edit")).toBeUndefined()
    expect(decide(reviewer.permission, "grep")).toBeUndefined()
    expect(decide(reviewer.permission, "bash")).toBe("deny")
    expect(decide(reviewer.permission, "write")).toBe("deny")
    expect(decide(reviewer.permission, "mcp__github__get_pr")).toBe("ask")
    expect(decide(reviewer.permission, "mcp__github__merge_pr")).toBe("deny")
    expect(agents.open).toMatchObject({ model: "anthropic/claude-opus-5", permission: [] })
  })

  test("oclite extensions are read from options", async () => {
    await using root = await tmpdir({
      git: true,
      files: {
        ".oclite/agents/remote.md": [
          "---",
          "description: Remote child",
          "mode: subagent",
          "transport: mcp",
          "mcp:",
          "  command: [oclite, mcp, serve]",
          "max_depth: 1",
          "read_only: true",
          "max_context_tokens: 64000",
          "thinking: off",
          "tools: [task, webfetch]",
          "steps: 12",
          "permission:",
          "  bash:",
          '    "git *": allow',
          "---",
          "Child prompt.",
        ].join("\n"),
      },
    })
    await using home = await tmpdir()
    const agent = (await load(root.path, home.path)).remote
    expect(agent).toMatchObject({
      mode: "subagent",
      transport: "mcp",
      mcp: { command: ["oclite", "mcp", "serve"] },
      max_depth: 1,
      read_only: true,
      max_context_tokens: 64000,
      thinking: "off",
      tools: ["task", "webfetch"],
      steps: 12,
      permission: [{ permission: "bash", pattern: "git *", action: "allow" }],
    })
  })

  test("invalid extension value is a ConfigError naming the file", async () => {
    await using root = await tmpdir({ git: true, files: { ".oclite/agents/bad.md": "---\nthinking: maybe\n---\nx" } })
    await using home = await tmpdir()
    const error = await load(root.path, home.path).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ConfigError)
    expect(String(error)).toContain("bad.md")
  })

  test("override order: built-in < user < .claude < .opencode < .oclite < config", async () => {
    await using root = await tmpdir({
      git: true,
      files: {
        ".claude/agents/x.md": "---\ndescription: claude\ntemperature: 0.2\n---\nclaude prompt",
        ".opencode/agent/x.md": "---\ndescription: opencode\n---\nopencode prompt",
        ".opencode/agents/team/lead.md": "---\ndescription: nested\n---\nlead",
        ".oclite/agents/x.md": "---\ndescription: oclite\n---\noclite prompt",
        ".oclite/agents/build.md": "---\ndescription: project build\n---\nproject build prompt",
      },
    })
    await using home = await tmpdir({ files: { ".config/oclite/agents/x.md": "---\ndescription: user\nsteps: 3\n---\nuser" } })
    const agents = await load(root.path, home.path, {
      x: override({ description: "config" }),
      plan: override({ disable: true }),
    })
    expect(agents.x).toMatchObject({ description: "config", prompt: "oclite prompt", steps: 3, temperature: 0.2, source: "config" })
    expect(agents["team/lead"].description).toBe("nested")
    expect(agents.build).toMatchObject({
      description: "project build",
      prompt: "project build prompt",
      mode: "primary",
      source: path.join(root.path, ".oclite/agents/build.md"),
    })
    expect(agents.plan).toBeUndefined()
  })
})
