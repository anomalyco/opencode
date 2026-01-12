import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { ConfigMarkdown } from "../config/markdown"
import { Filesystem } from "../util/filesystem"
import { Global } from "@/global"
import fs, { exists } from "fs/promises"
import path from "path"
import { Flag } from "@/flag/flag"
import { Log } from "../util/log"

export namespace Agent {
  const log = Log.create({ service: "agent" })
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const OPENCODE_AGENT_GLOB = new Bun.Glob("{agent,agents}/**/*.md")
  const CLAUDE_AGENT_GLOB = new Bun.Glob("agents/**/*.md")

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
      },
      question: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      build: {
        name: "build",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            edit: {
              "*": "deny",
              ".opencode/plan/*.md": "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
    }

    const apply = (key: string, value: any, prompt?: string) => {
      if (value.disable) {
        delete result[key]
        return
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          hidden: false,
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.prompt = prompt ?? value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? value.topP ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      apply(key, value)
    }

    const addAgent = async (match: string) => {
      const md = await ConfigMarkdown.parse(match)
      if (!md) return
      let name = path.basename(match, ".md")
      const patterns = ["/.opencode/agents/", "/.opencode/agent/", "/agents/", "/agent/"]
      const pattern = patterns.find((p) => match.includes(p))
      const agentFolderPath = pattern ? match.split(pattern)[1] : name + ".md"

      if (agentFolderPath.includes("/")) {
        const relativePath = agentFolderPath.replace(".md", "")
        const pathParts = relativePath.split("/")
        name = pathParts.slice(0, -1).join("/") + "/" + pathParts[pathParts.length - 1]
      }
      apply(name, md.data, md.content.trim())
    }

    // Scan .claude/agents/ directories (project-level)
    const claudeDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    // Also include global ~/.claude/agents/
    const globalClaude = `${Global.Path.home}/.claude`
    if (await exists(globalClaude)) {
      claudeDirs.push(globalClaude)
    }

    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
      for (const dir of claudeDirs) {
        const matches = await Array.fromAsync(
          CLAUDE_AGENT_GLOB.scan({
            cwd: dir,
            absolute: true,
            onlyFiles: true,
            followSymlinks: true,
            dot: true,
          }),
        ).catch((error) => {
          log.error("failed .claude directory scan for agents", { dir, error })
          return []
        })

        for (const match of matches) {
          await addAgent(match)
        }
      }
    }

    // Scan .opencode/agent/ directories
    for (const dir of await Config.directories()) {
      for await (const match of OPENCODE_AGENT_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addAgent(match)
      }
    }

    // Ensure Truncate.DIR is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some(
        (r) => r.permission === "external_directory" && r.pattern === Truncate.DIR && r.action === "deny",
      )
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    return state().then((x) => Object.keys(x)[0])
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()
    const result = await generateObject({
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    })
    return result.object
  }

  export async function save(input: {
    name: string
    description?: string
    systemPrompt: string
    model?: { providerID: string; modelID: string }
    mode?: "subagent" | "primary" | "all"
  }) {
    const dir = path.join(Instance.directory, ".opencode", "agents")
    const filePath = path.join(dir, `${input.name}.md`)

    const yaml = [
      `name: ${input.name}`,
      `description: "${input.description || ""}"`,
      `mode: ${input.mode || "all"}`,
      input.model ? `model: ${input.model.providerID}/${input.model.modelID}` : null,
    ]
      .filter(Boolean)
      .join("\n")

    const content = `---\n${yaml}\n---\n\n${input.systemPrompt}`

    if (!(await exists(dir))) {
      await fs.mkdir(dir, { recursive: true })
    }

    await Bun.write(filePath, content)
    log.info("saved agent", { path: filePath })

    state.clear()
  }
}
