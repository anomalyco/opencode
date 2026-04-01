import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { Config } from "../config/config"
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
      allowedTools: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string) {
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
    COMPACT: "compact",
    COST: "cost",
    DOCTOR: "doctor",
    DIFF: "diff",
    CONTEXT: "context",
    MEMORY: "memory",
    PERMISSIONS: "permissions",
    PLAN: "plan",
    VIM: "vim",
    EFFORT: "effort",
    HOOKS: "hooks",
  } as const

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Command") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const mcp = yield* MCP.Service
      const skill = yield* Skill.Service

      const init = Effect.fn("Command.state")(function* (ctx) {
        const cfg = yield* config.get()
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
        commands[Default.COMPACT] = {
          name: Default.COMPACT,
          description: "trigger context compaction immediately",
          source: "command",
          template: "",
          hints: [],
        }
        commands[Default.COST] = {
          name: Default.COST,
          description: "display session cost breakdown (tokens, USD, per-model)",
          source: "command",
          template:
            "Show the session cost breakdown: total tokens used (input, output, cache read/write), total cost in USD, and a per-model breakdown if multiple models were used. Format it clearly for the user.",
          hints: [],
        }
        commands[Default.DOCTOR] = {
          name: Default.DOCTOR,
          description: "run diagnostics (config validation, API connectivity, tool availability)",
          source: "command",
          template:
            "Run a system health check and report: 1) Validate the current configuration for any issues, 2) Check API key availability for the configured providers, 3) Check tool availability (bash, ripgrep, git, etc.), 4) Report any issues found with suggestions to fix them.",
          hints: [],
        }
        commands[Default.DIFF] = {
          name: Default.DIFF,
          description: "show git-style diff of all file changes in current session",
          source: "command",
          template:
            "Show a git-style diff of all file changes made in the current session. Run `git diff` to show unstaged changes and `git diff --cached` for staged changes. If there are no changes, say so.",
          hints: [],
        }
        commands[Default.CONTEXT] = {
          name: Default.CONTEXT,
          description: "show current token usage and context window utilization",
          source: "command",
          template:
            "Display the current context window utilization: tokens used vs the model's context limit, percentage used, and whether any compaction thresholds (warning 70%, error 85%, blocking 95%) have been reached.",
          hints: [],
        }
        commands[Default.MEMORY] = {
          name: Default.MEMORY,
          description: "manage persistent memories (list, view, add, delete)",
          source: "command",
          template:
            "List all stored memories. For each memory show its ID, type, title, and a short preview of the content. Provide instructions on how to view, add, or delete memories using follow-up commands.",
          hints: [],
        }
        commands[Default.PERMISSIONS] = {
          name: Default.PERMISSIONS,
          description: "view current permission mode and active rules",
          source: "command",
          template:
            "Display the current permission mode and all active permission rules. Show the mode name (default/plan/acceptEdits/bypassPermissions), and list each rule with its tool, pattern, and source (project config, user config, or session).",
          hints: [],
        }
        commands[Default.PLAN] = {
          name: Default.PLAN,
          description: "toggle plan mode (read-only, no file writes)",
          source: "command",
          template: "",
          hints: [],
        }
        commands[Default.VIM] = {
          name: Default.VIM,
          description: "toggle vim keybinding mode in the TUI",
          source: "command",
          template: "",
          hints: [],
        }
        commands[Default.EFFORT] = {
          name: Default.EFFORT,
          description: "set AI effort/thinking level (low, medium, high)",
          source: "command",
          template: "Set the AI thinking effort level to: $ARGUMENTS. Valid values are low, medium, or high.",
          hints: hints("$ARGUMENTS"),
        }
        commands[Default.HOOKS] = {
          name: Default.HOOKS,
          description: "list active hooks and their event subscriptions",
          source: "command",
          template:
            "List all active lifecycle hooks configured for this session. For each hook show its event type, optional pattern filter, command, and timeout. If no hooks are configured, say so.",
          hints: [],
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

        for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
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

        for (const item of yield* skill.all()) {
          if (commands[item.name]) continue
          commands[item.name] = {
            name: item.name,
            description: item.description,
            source: "skill",
            get template() {
              return item.content
            },
            hints: [],
            allowedTools: item.allowedTools,
          }
        }

        return {
          commands,
        }
      })

      const cache = yield* InstanceState.make<State>((ctx) => init(ctx))

      const get = Effect.fn("Command.get")(function* (name: string) {
        const state = yield* InstanceState.get(cache)
        return state.commands[name]
      })

      const list = Effect.fn("Command.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return Object.values(state.commands)
      })

      return Service.of({ get, list })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(Skill.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(name: string) {
    return runPromise((svc) => svc.get(name))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}
