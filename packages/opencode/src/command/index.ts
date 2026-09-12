import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { CommandEvent } from "@opencode-ai/schema/command-event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Effect, Layer, Context, Schema, Deferred } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"

type State = {
  commands: Record<string, Info>
  // Resolves once the background MCP prompt merge settles, successfully or not.
  mcpSettled: Deferred.Deferred<void, never>
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

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
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  /** Resolves once MCP prompts have settled; file-based commands never wait on it. */
  readonly ready: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service
    const events = yield* EventV2Bridge.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
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

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        const dir = item.location === "<built-in>" ? undefined : path.dirname(item.location)
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: "skill",
          get template() {
            if (!dir) return item.content
            return [
              item.content,
              "",
              `Base directory for this skill: ${dir}`,
              "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
            ].join("\n")
          },
          hints: [],
        }
      }

      // MCP prompts block on every server connecting (seconds each). Load
      // file-based commands now and merge MCP prompts in the background,
      // publishing CommandEvent.Updated so clients re-fetch; MCP keeps its
      // old name-precedence override.
      const mcpSettled = yield* Deferred.make<void, never>()
      const mergeMcpPrompts = Effect.fn("Command.mergeMcpPrompts")(function* () {
        yield* Effect.ensuring(
          Effect.gen(function* () {
            const prompts = yield* mcp.prompts()
            for (const [name, prompt] of Object.entries(prompts)) {
              commands[name] = {
                name,
                source: "mcp",
                description: prompt.description,
                get template() {
                  return bridge.promise(
                    mcp
                      .getPrompt(
                        prompt.client,
                        prompt.name,
                        prompt.arguments
                          ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                          : {},
                      )
                      .pipe(
                        Effect.map(
                          (template) =>
                            template?.messages
                              .map((message) => (message.content.type === "text" ? message.content.text : ""))
                              .join("\n") || "",
                        ),
                      ),
                  )
                },
                hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
              }
            }
            if (Object.keys(prompts).length > 0) yield* events.publish(CommandEvent.Updated, {})
          }),
          // Settle even on failure so `ready()` awaiters never hang.
          Deferred.succeed(mcpSettled, undefined),
        )
      })
      yield* mergeMcpPrompts().pipe(
        Effect.catchCause((cause) => Effect.logWarning("Command MCP prompt merge failed", { cause })),
        Effect.forkScoped,
      )
      // Also settle from the entry scope in case the fiber is interrupted
      // before its `ensuring` finalizer registers; double-succeed is a no-op.
      yield* Effect.addFinalizer(() => Deferred.succeed(mcpSettled, undefined))

      return {
        commands,
        mcpSettled,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    const ready = Effect.fn("Command.ready")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* Deferred.await(s.mcpSettled)
    })

    return Service.of({ get, list, ready })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, MCP.node, Skill.node, EventV2Bridge.node],
})

export * as Command from "."
