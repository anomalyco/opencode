import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import { Glob } from "../util/glob"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  function createBuiltInCommands() {
    return {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
    } as Record<string, Info>
  }

  const commandCache = new Map<string, { command: Info; mtime: number; filePath: string }>()

  function rel(item: string, patterns: string[]) {
    const normalizedItem = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = normalizedItem.indexOf(pattern)
      if (index === -1) continue
      return normalizedItem.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  async function findCommandFile(name: string): Promise<{ path: string } | null> {
    const directories = await Config.directories()
    for (const dir of directories) {
      const subdirs = ["command", "commands", ".opencode/command", ".opencode/commands"]
      for (const subdir of subdirs) {
        const filePath = path.join(dir, subdir, name + ".md")
        if (existsSync(filePath)) {
          return { path: filePath }
        }
        const nested = path.join(dir, subdir, name + "/index.md")
        if (existsSync(nested)) {
          return { path: nested }
        }
      }
    }
    return null
  }

  async function loadSingleCommand(filePath: string): Promise<Info | null> {
    const md = await ConfigMarkdown.parse(filePath).catch(() => null)
    if (!md) return null

    const patterns = ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"]
    const file = rel(filePath, patterns) ?? path.basename(filePath)
    const cmdName = trim(file)

    const config = { name: cmdName, ...md.data, template: md.content.trim() }
    const parsed = Config.Command.safeParse(config)
    if (!parsed.success) return null

    return {
      ...parsed.data,
      name: cmdName,
      hints: hints(parsed.data.template),
    }
  }

  const state = Instance.state(async () => {
    const cfg = await Config.get()
    const result = createBuiltInCommands()

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "command",
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    // Add skills as invokable commands
    for (const skill of await Skill.all()) {
      // Skip if a command with this name already exists
      if (result[skill.name]) continue
      result[skill.name] = {
        name: skill.name,
        description: skill.description,
        source: "skill",
        get template() {
          return skill.content
        },
        hints: [],
      }
    }

    return result
  })

  async function loadFreshCommands(): Promise<Record<string, Info>> {
    const result = createBuiltInCommands()
    const cfg = await Config.get()

    // Load commands from config file (non-markdown)
    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        ...command,
        name,
        hints: Command.hints(command.template),
      }
    }

    // Reload commands from markdown files in each config directory
    const directories = await Config.directories()
    for (const dir of directories) {
      const commands = await Config.reloadCommands(dir)
      for (const [name, command] of Object.entries(commands)) {
        result[name] = {
          ...command,
          name,
          hints: Command.hints(command.template),
        }
      }
    }

    return result
  }

  async function loadFreshCommandsWithMtime(): Promise<Record<string, Info>> {
    const result = createBuiltInCommands()
    const cfg = await Config.get()

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = { ...command, name, hints: Command.hints(command.template) }
    }

    const directories = await Config.directories()
    for (const dir of directories) {
      const subdirs = ["command", "commands", ".opencode/command", ".opencode/commands"]
      for (const subdir of subdirs) {
        const cmdDir = path.join(dir, subdir)
        if (!existsSync(cmdDir)) continue

        const files = await Glob.scan("**/*.md", { cwd: cmdDir, absolute: true, dot: true, symlink: true })
        for (const filePath of files) {
          const stat = await fs.stat(filePath)
          const mtime = stat.mtimeMs
          const patterns = ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"]
          const file = rel(filePath, patterns) ?? path.basename(filePath)
          const cmdName = trim(file)

          const cached = commandCache.get(cmdName)
          if (cached && cached.filePath === filePath && cached.mtime === mtime) {
            result[cmdName] = cached.command
            continue
          }

          const command = await loadSingleCommand(filePath)
          if (command) {
            commandCache.set(cmdName, { command, mtime, filePath })
            result[cmdName] = command
          }
        }
      }
    }

    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      if (!result[name]) {
        result[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return new Promise<string>(async (resolve, reject) => {
              const template = await MCP.getPrompt(
                prompt.client,
                prompt.name,
                prompt.arguments
                  ? Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                  : {},
              ).catch(reject)
              resolve(
                template?.messages
                  .map((message) => (message.content.type === "text" ? message.content.text : ""))
                  .join("\n") || "",
              )
            })
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }
    }

    for (const skill of await Skill.all()) {
      if (!result[skill.name]) {
        result[skill.name] = {
          name: skill.name,
          description: skill.description,
          source: "skill",
          get template() {
            return skill.content
          },
          hints: [],
        }
      }
    }

    return result
  }

  export async function get(name: string) {
    const cfg = await Config.get()

    if (cfg.experimental?.cache_command_markdown_files !== false) {
      return state().then((x) => x[name])
    }

    const builtIn = createBuiltInCommands()
    if (builtIn[name]) return builtIn[name]

    const cached = commandCache.get(name)
    const fileInfo = await findCommandFile(name)

    // Only use cfg.command as fallback if no markdown file exists on disk
    if (!fileInfo && cfg.command?.[name]) {
      return { ...cfg.command[name], name, hints: Command.hints(cfg.command[name].template) }
    }

    if (!fileInfo) {
      const fresh = await loadFreshCommandsWithMtime()
      return fresh[name]
    }

    const stat = await fs.stat(fileInfo.path)
    const mtime = stat.mtimeMs

    if (cached && cached.filePath === fileInfo.path && cached.mtime === mtime) {
      return cached.command
    }

    const command = await loadSingleCommand(fileInfo.path)
    if (command) {
      commandCache.set(name, { command, mtime, filePath: fileInfo.path })
    }
    return command
  }

  export async function list() {
    const cfg = await Config.get()

    if (cfg.experimental?.cache_command_markdown_files !== false) {
      return state().then((x) => Object.values(x))
    }

    const fresh = await loadFreshCommandsWithMtime()
    return Object.values(fresh)
  }
}
