import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Workflow } from "@/workflow/workflow"
import { EventV2 } from "@opencode-ai/core/event"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: EventV2.define({
    type: "command.executed",
    schema: {
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID,
    },
  }),
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill", "workflow"])),
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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service
    const workflow = yield* Workflow.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      // T5 (/init): surface discovered workflows in the generated AGENTS.md prompt
      // so the init pass documents them. Names + descriptions (falling back to
      // whenToUse). Only VALID workflows are listed; the section is omitted
      // entirely when none remain, so a repo with no workflows gets the unchanged
      // prompt. list() is the static (never-executed) reader — safe at build time.
      const allWorkflows = (yield* workflow.list()).filter((wf) => wf.valid !== false)
      // The init section documents REPO/PROJECT-defined workflows ("This repository
      // defines …"); the builtins that ship inside opencode (source_kind "builtin",
      // e.g. deep-research) are not repo-specific, so they are excluded from the
      // prompt section. They still register as Command.Info entries via the loop below.
      const initWorkflows = allWorkflows.filter((wf) => wf.source_kind !== "builtin")
      const workflowsSection =
        initWorkflows.length === 0
          ? ""
          : "\n\n## Available workflows\n\nThis repository defines OpenCode workflows. Mention them in `AGENTS.md` so future sessions know they exist:\n\n" +
            initWorkflows
              .map((wf) => {
                const desc = wf.meta.description ?? wf.meta.whenToUse
                return desc ? `- \`${wf.name}\` — ${desc}` : `- \`${wf.name}\``
              })
              .join("\n")

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree) + workflowsSection
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

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
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
        }
      }

      // Spec §5.2 (3) / Delta 4+5: discovered workflows become real Command.Info
      // entries (source "workflow") so they appear in /help and Command.list()
      // (the TUI's sync.data.command), in parity with the autocomplete /<name>
      // path. Runs LAST so any real command/mcp/skill of the same name wins
      // (collision skip via `if (commands[wf.name]) continue`); invalid (broken)
      // workflow files cannot be started, so they are skipped too.
      // DELTA: source "workflow" is DISCOVERY-ONLY — the TUI dispatch starts these
      // via the /workflow path (see AUTOCOMPLETE), NOT via session.command, so the
      // empty `template` is never executed as a prompt.
      // Reuses `allWorkflows` (already filtered to valid, INCLUDING builtins so
      // deep-research still registers as a command) instead of a second
      // workflow.list() call. The `valid === false` guard is now redundant but kept
      // for clarity; the collision skip below still applies.
      for (const wf of allWorkflows) {
        if (wf.valid === false) continue
        if (commands[wf.name]) continue
        commands[wf.name] = {
          name: wf.name,
          description: wf.meta.description ?? wf.meta.whenToUse,
          source: "workflow",
          get template() {
            return ""
          },
          hints: [],
        }
      }

      return {
        commands,
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

    return Service.of({ get, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Workflow.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, MCP.node, Skill.node, Workflow.node])

export * as Command from "."
