import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Instance } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import { Config } from "../config/config"
import { ConfigMarkdown } from "../config/markdown"
import { Glob } from "../util/glob"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Log } from "../util/log"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

export namespace Command {
  const log = Log.create({ service: "command" })

  type State = {
    commands: Record<string, Info>
  }

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

  // Cache for command file mtimes when cache_command_markdown_files is false
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

  async function loadFreshCommands(): Promise<Record<string, Info>> {
    const result: Record<string, Info> = {}
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
    const result: Record<string, Info> = createBuiltInCommands()
    const cfg = await Config.get()

    // Load commands from config file (non-markdown)
    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = { ...command, name, hints: Command.hints(command.template) }
    }

    // Load commands from markdown files with mtime checking
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

    // Add MCP prompts
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

    // Add skills
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

  function createBuiltInCommands(): Record<string, Info> {
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
    }
  }

  export function hints(template: string) {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    const extended = template.match(/\$\{(\d+|\d*\.\.\d*)\}/g)
    if (extended) {
      for (const match of [...new Set(extended)].sort()) {
        if (!result.includes(match)) result.push(match)
      }
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Command") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const init = Effect.fn("Command.state")(function* (ctx) {
        const cfg = yield* Effect.promise(() => Config.get())
        const commands: Record<string, Info> = {}

        commands[Default.INIT] = {
          name: Default.INIT,
          description: "create/update AGENTS.md",
          source: "command",
          get template() {
            return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
          },
          hints: hints(PROMPT_INITIALIZE),
        }
        commands[Default.REVIEW] = {
          name: Default.REVIEW,
          description: "review changes [commit|branch|pr], defaults to uncommitted",
          source: "command",
          get template() {
            return PROMPT_REVIEW.replace("${path}", ctx.worktree)
          },
          subtask: true,
          hints: hints(PROMPT_REVIEW),
        }

        for (const [name, command] of Object.entries(cfg.command ?? {})) {
          commands[name] = {
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

        for (const [name, prompt] of Object.entries(yield* Effect.promise(() => MCP.prompts()))) {
          commands[name] = {
            name,
            source: "mcp",
            description: prompt.description,
            get template() {
              return new Promise<string>(async (resolve, reject) => {
                const template = await MCP.getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
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

        for (const skill of yield* Effect.promise(() => Skill.all())) {
          if (commands[skill.name]) continue
          commands[skill.name] = {
            name: skill.name,
            description: skill.description,
            source: "skill",
            get template() {
              return skill.content
            },
            hints: [],
          }
        }

        return {
          commands,
        }
      })

      const cache = yield* InstanceState.make<State>((ctx) => init(ctx))

      const get = Effect.fn("Command.get")(function* (name: string) {
        const cfg = yield* Effect.promise(() => Config.get())
        // When experimental.cache_command_markdown_files is explicitly false,
        // reload commands from disk on each call
        if (cfg.experimental?.cache_command_markdown_files === false) {
          const builtIn = createBuiltInCommands()
          if (builtIn[name]) return builtIn[name]

          const cached = commandCache.get(name)
          const fileInfo = yield* Effect.promise(() => findCommandFile(name))

          // Only use cfg.command as fallback if no markdown file exists on disk
          if (!fileInfo && cfg.command?.[name]) {
            return { ...cfg.command[name], name, hints: Command.hints(cfg.command[name].template) }
          }

          if (!fileInfo) {
            return undefined
          }

          // Check if we have a cached version with valid mtime
          if (cached && cached.filePath === fileInfo.path) {
            const stat = yield* Effect.promise(() => fs.stat(fileInfo.path))
            if (stat.mtimeMs === cached.mtime) {
              return cached.command
            }
          }

          // Load fresh from disk
          const command = yield* Effect.promise(() => loadSingleCommand(fileInfo.path))
          if (command) {
            const stat = yield* Effect.promise(() => fs.stat(fileInfo.path))
            commandCache.set(name, { command, mtime: stat.mtimeMs, filePath: fileInfo.path })
          }
          return command ?? undefined
        }
        const state = yield* InstanceState.get(cache)
        return state.commands[name]
      })

      const list = Effect.fn("Command.list")(function* () {
        const cfg = yield* Effect.promise(() => Config.get())
        // When experimental.cache_command_markdown_files is explicitly false,
        // reload commands from disk on each call
        if (cfg.experimental?.cache_command_markdown_files === false) {
          const fresh = yield* Effect.promise(() => loadFreshCommandsWithMtime())
          return Object.values(fresh)
        }
        const state = yield* InstanceState.get(cache)
        return Object.values(state.commands)
      })

      return Service.of({ get, list })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function get(name: string) {
    return runPromise((svc) => svc.get(name))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}
