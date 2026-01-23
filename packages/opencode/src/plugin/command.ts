import type {
  Hooks,
  PluginCommand as PluginCommandDefinition,
  PluginCommandInput,
  PluginCommandMode,
  PluginCommandOutput,
} from "@opencode-ai/plugin"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Plugin } from "."

export namespace PluginCommand {
  export type Mode = PluginCommandMode
  export type Entry = {
    name: string
    description?: string
    agent?: string
    model?: string
    subtask?: boolean
    hints: string[]
    template: Promise<string> | string
    mode: Mode
    source: string
    execute?: Hooks["command.execute"]
  }

  const log = Log.create({ service: "plugin.command" })

  const state = Instance.state(async () => {
    const hooks = await Plugin.list()
    const result: Record<string, Entry> = {}
    for (const hook of hooks) {
      const commands = hook.command ?? []
      if (commands.length === 0) continue
      const source = Plugin.name(hook)
      const execute = hook["command.execute"]
      for (const command of commands as PluginCommandDefinition[]) {
        const name = command.name?.trim()
        if (!name) {
          log.warn("plugin command missing name", { plugin: source })
          continue
        }
        const mode = command.mode ?? "llm"
        if (mode !== "llm" && mode !== "plugin") {
          log.warn("plugin command invalid mode", { plugin: source, command: name, mode: command.mode })
          continue
        }
        if (mode === "llm" && !command.template) {
          log.warn("plugin command missing template", { plugin: source, command: name })
          continue
        }
        if (mode === "plugin" && !execute) {
          log.warn("plugin command missing handler", { plugin: source, command: name })
          continue
        }
        if (result[name]) {
          log.warn("plugin command collision", { plugin: source, command: name, existing: result[name].source })
          continue
        }
        const hints = Array.isArray(command.hints) ? command.hints : []
        const template = command.template ?? ""
        result[name] = {
          name,
          description: command.description,
          agent: command.agent,
          model: command.model,
          subtask: command.subtask,
          hints,
          template,
          mode,
          source,
          execute,
        }
      }
    }
    return result
  })

  export async function list() {
    return state()
  }

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function execute(name: string, input: PluginCommandInput): Promise<PluginCommandOutput | undefined> {
    const entry = await get(name)
    if (!entry) return undefined
    if (entry.mode !== "plugin") return undefined
    if (!entry.execute) return undefined
    return entry.execute(input)
  }
}
