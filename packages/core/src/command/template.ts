export * as CommandTemplate from "./template.js"

import type { CommandTemplateDefinition } from "@opencode-ai/plugin/effect/command"
import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { AppProcess } from "@opencode-ai/util/process"
import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Agent } from "../agent.js"
import { Command } from "../command.js"
import { Job } from "../job.js"
import { Location } from "../location.js"
import { Session } from "../session.js"
import { SubagentJob } from "../session/subagent-job.js"
import { ShellSelect } from "../shell/select.js"

export interface Interface {
  readonly definition: (command: CommandTemplateDefinition) => Command.Definition
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CommandTemplate") {}

export const make = Effect.fn("CommandTemplate.make")(function* (
  api?: Pick<PluginContext, "agent" | "session">,
) {
  const location = yield* Location.Service
  const processes = yield* AppProcess.Service
  const shell = yield* ShellSelect.Service
  const sessions = yield* Session.Service
  const agents = yield* Agent.Service
  const subagents = yield* SubagentJob.make

  return Service.of({
    definition: (command): Command.Definition => ({
      name: command.name,
      description: command.description,
      execute: (input) =>
        Effect.gen(function* () {
          const agent = command.agent === undefined ? undefined : Agent.ID.make(command.agent)
          const commandAgent =
            agent === undefined
              ? undefined
              : api === undefined
                ? yield* agents.get(agent)
                : (yield* api.agent.get({ agentID: agent })).data
          if (agent !== undefined && commandAgent === undefined)
            return yield* Effect.fail(new Error(`Agent not found: ${agent}`))
          const model =
            command.model === undefined
              ? commandAgent?.model
              : {
                  id: Model.ID.make(command.model.model),
                  providerID: Provider.ID.make(command.model.providerID),
                  ...(command.model.variant === undefined
                    ? {}
                    : { variant: Model.VariantID.make(command.model.variant) }),
                }
          const text = yield* evaluate(command.template, input.prompt.text, { location, processes, shell })
          if (command.subagent ?? commandAgent?.mode === "subagent") {
            const parent = yield* sessions.get(input.sessionID)
            const selected = yield* agents.select(agent ?? parent.agent)
            const child = yield* sessions.create({
              parentID: parent.id,
              title: command.description ?? command.name,
              agent: selected.id,
              model: model ?? selected.info?.model ?? parent.model,
            })
            yield* sessions.prompt({
              ...input.prompt,
              sessionID: child.id,
              text: ["You are a subagent spawned by another session.", text].join("\n"),
              resume: false,
            })
            const recovery = {
              kind: "subagent" as const,
              parentSessionID: parent.id,
              childSessionID: child.id,
              agent: selected.id,
              description: command.description ?? command.name,
            }
            yield* subagents.start(recovery)
            yield* subagents.background(recovery)
            return
          }
          if (agent !== undefined) {
            const session = yield* (api?.session.get({ sessionID: input.sessionID }) ?? sessions.get(input.sessionID))
            if (session.agent !== agent)
              yield* (api?.session.switchAgent({ sessionID: input.sessionID, agent }) ??
                sessions.switchAgent({ sessionID: input.sessionID, agent }))
          }
          if (model !== undefined)
            yield* (api?.session.switchModel({ sessionID: input.sessionID, model }) ??
              sessions.switchModel({ sessionID: input.sessionID, model }))
          yield* (api?.session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text,
            delivery: input.delivery,
          }) ??
            sessions.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text,
              delivery: input.delivery,
            }))
        }).pipe(Effect.asVoid),
    }),
  })
})

export const layer = Layer.effect(Service, make())

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, AppProcess.node, ShellSelect.node, Session.node, Agent.node, Job.node],
})

function evaluate(
  template: string,
  input: string,
  services: {
    readonly location: Location.Info
    readonly processes: AppProcess.Interface
    readonly shell: ShellSelect.Interface
  },
) {
  return Effect.gen(function* () {
    const args = parseArguments(input)
    const placeholders = template.match(placeholderRegex) ?? []
    const last = Math.max(0, ...placeholders.map((item) => Number(item.slice(1))))
    const expanded = template.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    const withArguments = expanded.replaceAll("$ARGUMENTS", input)
    const text =
      placeholders.length === 0 && !template.includes("$ARGUMENTS") && input.trim()
        ? `${withArguments}\n\n${input}`.trim()
        : withArguments.trim()
    const matches = Array.from(text.matchAll(shellRegex))
    if (matches.length === 0) return text
    const executable = yield* services.shell.resolve({ priority: "config" })
    const outputs = yield* Effect.forEach(
      matches,
      (match) => {
        const source = match[1] ?? ""
        return services.processes
          .run(
            ChildProcess.make(executable, ShellSelect.args(executable, source), {
              cwd: services.location.directory,
              stdin: "ignore",
            }),
            { combineOutput: true },
          )
          .pipe(
            Effect.map((result) => (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8")),
            Effect.mapError(
              (error) => new Error(`Shell interpolation failed for ${JSON.stringify(source)}: ${error.message}`),
            ),
          )
      },
      { concurrency: 2 },
    )
    const iterator = outputs[Symbol.iterator]()
    return text.replace(shellRegex, () => iterator.next().value ?? "")
  })
}

function parseArguments(input: string) {
  return (input.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
const shellRegex = /!`([^`]+)`/g
