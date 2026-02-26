import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Cache } from "../../src/cache"
import { Discover } from "../../src/cache/discover"
import { Embed } from "../../src/cache/embed"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Skill } from "../../src/skill"
import { SkillTool } from "../../src/tool/skill"
import type { SessionProcessor } from "../../src/session/processor"

function snapshotTools(input: Record<string, any>) {
  const normalize = (value: string) => value.replace(/opencode-test-[a-z0-9]+/gi, "opencode-test-tmp")
  return Object.fromEntries(
    Object.entries(input)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, item]) => [
        id,
        {
          description: normalize(item.description),
          inputSchema: normalize(JSON.stringify(item.inputSchema)),
        },
      ]),
  )
}

function skillDescription(skills: Awaited<ReturnType<typeof Skill.all>>) {
  if (skills.length === 0) {
    return "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
  }

  return [
    "Load a specialized skill that provides domain-specific instructions and workflows.",
    "",
    "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
    "",
    "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
    "",
    'Tool output includes a `<skill_content name="...">` block with the loaded content.',
    "",
    "The following skills provide specialized sets of instructions for particular tasks",
    "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
    "",
    "<available_skills>",
    ...skills.flatMap((skill) => [
      `  <skill>`,
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
      `    <location>${pathToFileURL(skill.location).href}</location>`,
      `  </skill>`,
    ]),
    "</available_skills>",
  ].join("\n")
}

async function resolveToolSet(cache: boolean) {
  await using tmp = await tmpdir({
    git: true,
    config: {
      experimental: {
        cache: {
          enabled: cache,
        },
      },
      agent: {
        build: {
          model: "opencode/kimi-k2.5-free",
        },
      },
    },
  })

  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parsed = await Provider.defaultModel()
      const model = await Provider.getModel(parsed.providerID, parsed.modelID)
      const agent = await Agent.get("build")
      const session = await Session.create({})

      const tools = await SessionPrompt.resolveTools({
        agent,
        model,
        session,
        bypassAgentCheck: true,
        messages: [],
        processor: {
          message: { id: "m" },
          partFromToolCall() {
            return undefined
          },
        } as unknown as SessionProcessor.Info,
      })

      await Session.remove(session.id)
      return snapshotTools(tools)
    },
  })
}

describe("cache.integration", () => {
  afterEach(() => {
    Cache.close()
  })

  test("promote on L2 item demotes oldest L1", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
            maxTools: 20,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (let i = 0; i < 30; i++) {
          await Cache.registerTool({
            id: `it_${i}`,
            name: `it_${i}`,
            description: `integration tool ${i}`,
            schema_json: "{}",
          })
        }

        for (let i = 0; i < 20; i++) {
          await Cache.promoteTool(`it_${i}`)
        }

        const before = await Cache.l1Tools()
        expect(before.size).toBe(20)
        expect(before.has("it_29")).toBe(false)

        await Cache.touchTool("it_19")
        await Cache.promoteTool("it_29")

        const after = await Cache.l1Tools()
        expect(after.size).toBe(20)
        expect(after.has("it_29")).toBe(true)
        expect(after.has("it_0")).toBe(false)
      },
    })
  })

  test("discover surfaces relevant tools in top-3", async () => {
    const labels = [
      "github_create_pr",
      "github_list_pr",
      "git_commit",
      "docker_build",
      "slack_send",
      "s3_upload",
      "calendar_event",
      "jira_create_issue",
      "kubernetes_restart",
      "notion_create_page",
      "email_send",
      "read_file",
      "grep_search",
      "http_get",
      "postgres_query",
    ]

    const text = [
      "Create a GitHub pull request",
      "List pull requests from a GitHub repository",
      "Create a git commit for local changes",
      "Build a Docker image",
      "Send a Slack message",
      "Upload object to S3 bucket",
      "Create a calendar event",
      "Open a Jira issue",
      "Restart a Kubernetes deployment",
      "Create a Notion page",
      "Send an email",
      "Read local file contents",
      "Search file text with regex",
      "Fetch a URL over HTTP",
      "Run a SQL query in Postgres",
    ]

    const rows = labels.map((id, i) => ({
      id,
      name: id,
      description: text[i],
      schema_json: "{}",
      embedding: Embed.tfidf([text[i]])[0],
      is_l1: 0,
      use_count: 0,
      registered: Date.now(),
    }))

    const result = await Discover.tools("search github", 3, rows)
    expect(result.map((item) => item.id)).toContain("github_create_pr")
  })

  test("cache enabled with 0 rows adds only cache control tools", async () => {
    const off = await resolveToolSet(false)
    const on = await resolveToolSet(true)

    const cacheTools = new Set(["cache_discover_tool", "cache_enable_tool", "cache_discover_skill"])
    const offIds = Object.keys(off)
    const onIds = Object.keys(on)
    expect(onIds.filter((id) => !offIds.includes(id)).sort()).toEqual([...cacheTools].sort())
    expect(offIds.filter((id) => !onIds.includes(id))).toEqual([])

    const onBase = Object.fromEntries(Object.entries(on).filter(([id]) => !cacheTools.has(id)))
    expect(onBase).toEqual(off)
  })

  test("skill description is byte-identical when cache is disabled", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "stable-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: stable-skill
description: A stable test skill description.
---

# Stable Skill
`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const all = await Skill.all()
        const tool = await SkillTool.init()
        expect(tool.description).toBe(skillDescription(all))
      },
    })
  })
})