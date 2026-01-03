import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { MCP } from "../mcp"
import { WellKnown } from "@/util/wellknown"
import { Log } from "@/util/log"
import { ConfigMarkdown } from "@/config/markdown"

export namespace Command {
  const log = Log.create({ service: "command" })

  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      mcp: z.boolean().optional(),
      remote: z.boolean().optional(),
      baseUrl: z.string().optional(),
      hostname: z.string().optional(),
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

  /**
   * Load remote commands from all authenticated wellknown endpoints.
   * Returns commands keyed by their original name (not namespaced).
   * Namespacing only happens during merge if there's a local collision.
   * First authenticated endpoint wins for remote collisions.
   */
  async function loadRemoteCommands(): Promise<Record<string, Info>> {
    const cfg = await Config.get()
    if (cfg.experimental?.remote_commands === false) {
      return {}
    }

    const commands: Record<string, Info> = {}
    const endpoints = await WellKnown.getAuthenticatedEndpoints()

    for (const baseUrl of endpoints) {
      const index = await WellKnown.getIndex(baseUrl)
      if (!index?.commands) continue

      const hostname = WellKnown.getHostname(baseUrl)

      for (const [name, command] of Object.entries(index.commands)) {
        // First endpoint wins for same command name
        if (commands[name]) {
          log.warn("duplicate remote command name", {
            name,
            existing: commands[name].name,
            duplicate: command.url,
          })
          continue
        }

        commands[name] = {
          name,
          description: command.description,
          remote: true,
          baseUrl,
          hostname,
          get template() {
            return fetchRemoteCommandTemplate(command.url, baseUrl)
          },
          hints: [], // Will be populated when template is fetched
        }
      }
    }

    return commands
  }

  /**
   * Fetch and parse a remote command template.
   * Returns the template content from the markdown file.
   */
  async function fetchRemoteCommandTemplate(url: string, baseUrl: string): Promise<string> {
    const content = await WellKnown.fetchContent(url, baseUrl)
    if (!content) {
      log.warn("failed to fetch remote command content", { url })
      return ""
    }

    // Parse markdown frontmatter
    const md = ConfigMarkdown.parseContent(content)
    return md?.content?.trim() ?? content.trim()
  }

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
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
        mcp: true,
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

    // Load remote commands from wellknown endpoints
    // Remote commands use plain names by default, but get namespaced (hostname:name)
    // if there's a collision with a local command
    const remoteCommands = await loadRemoteCommands()
    for (const [name, command] of Object.entries(remoteCommands)) {
      if (result[name]) {
        // Local command exists - namespace the remote command
        const namespacedName = `${command.hostname}:${name}`
        log.debug("namespacing remote command due to local collision", { name, namespacedName })
        result[namespacedName] = { ...command, name: namespacedName }
      } else {
        result[name] = command
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
