export * as CommandV2 from "./command"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Command } from "@opencode-ai/schema/command"
import { State } from "./state"
import { MCP } from "./mcp/index"
import { EventV2 } from "./event"
import { AppProcess } from "./process"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "./config"
import { Location } from "./location"
import { ShellSelect } from "./shell/select"

export const Info = Command.Info
export type Info = Command.Info
export const Event = Command.Event

export type Evaluation = {
  readonly text: string
}

export type Data = {
  commands: Map<string, Types.DeepMutable<Info>>
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Command.NotFoundError", {
  command: Schema.String,
  message: Schema.String,
}) {}

export class EvaluationError extends Schema.TaggedErrorClass<EvaluationError>()("Command.EvaluationError", {
  command: Schema.String,
  message: Schema.String,
}) {}

export type Draft = {
  list: () => readonly Info[]
  get: (name: string) => Info | undefined
  update: (name: string, update: (command: Types.DeepMutable<Info>) => void) => void
  remove: (name: string) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly evaluate: (input: {
    readonly name: string
    readonly arguments?: string
  }) => Effect.Effect<Evaluation, NotFoundError | EvaluationError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const events = yield* EventV2.Service
    const processes = yield* AppProcess.Service
    const config = yield* Config.Service
    const location = yield* Location.Service
    const state = State.create<Data, Draft>({
      initial: () => ({ commands: new Map() }),
      draft: (draft) => ({
        list: () => Array.from(draft.commands.values()) as Info[],
        get: (name) => draft.commands.get(name),
        update: (name, update) => {
          const current = draft.commands.get(name) ?? ({ name, template: "" } as Types.DeepMutable<Info>)
          if (!draft.commands.has(name)) draft.commands.set(name, current)
          update(current)
          current.name = name
        },
        remove: (name) => {
          draft.commands.delete(name)
        },
      }),
      finalize: () => events.publish(Event.Updated, {}).pipe(Effect.asVoid),
    })
    const staticCommand = (name: string) => state.get().commands.get(name) as Info | undefined
    const mcpCommands = Effect.fnUntraced(function* () {
      return (yield* mcp.prompts()).map((prompt) =>
        Info.make({
          name: mcpCommandName(prompt.server, prompt.name),
          template: "",
          description: prompt.description,
        }),
      )
    })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("CommandV2.get")(function* (name) {
        const command = staticCommand(name)
        if (command) return command
        return (yield* mcpCommands()).find((command) => command.name === name)
      }),
      list: Effect.fn("CommandV2.list")(function* () {
        const commands = Array.from(state.get().commands.values()) as Info[]
        const names = new Set(commands.map((command) => command.name))
        return [
          ...commands,
          ...(yield* mcpCommands()).filter((command) => !names.has(command.name)),
        ]
      }),
      evaluate: Effect.fn("CommandV2.evaluate")(function* (input) {
        const command = staticCommand(input.name)
        if (command) return yield* evaluateTemplate(input.name, command.template, input.arguments ?? "", {
          config,
          location,
          processes,
        })

        const prompt = (yield* mcp.prompts()).find((prompt) => mcpCommandName(prompt.server, prompt.name) === input.name)
        if (!prompt) return yield* new NotFoundError({ command: input.name, message: `Command not found: ${input.name}` })
        const result = yield* mcp
          .prompt({
            server: prompt.server,
            name: prompt.name,
            args: Object.fromEntries(
              (prompt.arguments ?? []).map((argument, index) => [
                argument.name,
                parseArguments(input.arguments ?? "")[index] ?? "",
              ]),
            ),
          })
          .pipe(
            Effect.catchTag(
              "MCP.NotFoundError",
              () =>
                Effect.fail(
                  new EvaluationError({
                    command: input.name,
                    message: `MCP server could not be found while evaluating prompt: ${prompt.server}`,
                  }),
                ),
            ),
          )
        if (!result)
          return yield* new EvaluationError({
            command: input.name,
            message: `MCP prompt could not be evaluated: ${prompt.server}:${prompt.name}`,
          })
        return { text: result.messages.map((message) => promptMessageText(message.content)).join("\n").trim() }
      }),
    })
  }),
)

function evaluateTemplate(
  command: string,
  template: string,
  input: string,
  services: {
    readonly config: Config.Interface
    readonly location: Location.Info
    readonly processes: AppProcess.Interface
  },
) {
  return Effect.gen(function* () {
    const expanded = evaluateArguments(template, input)
    return { text: yield* evaluateShell(command, expanded, services) }
  })
}

function evaluateArguments(template: string, input: string) {
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
  if (placeholders.length === 0 && !template.includes("$ARGUMENTS") && input.trim()) return `${withArguments}\n\n${input}`.trim()
  return withArguments.trim()
}

const evaluateShell = Effect.fnUntraced(function* (
  command: string,
  text: string,
  services: {
    readonly config: Config.Interface
    readonly location: Location.Info
    readonly processes: AppProcess.Interface
  },
) {
  const matches = Array.from(text.matchAll(shellRegex))
  if (matches.length === 0) return text
  const shell = ShellSelect.preferred(Config.latest(yield* services.config.entries(), "shell"))
  const outputs = yield* Effect.forEach(
    matches,
    (match) => {
      const source = match[1] ?? ""
      return services.processes
        .run(ChildProcess.make(shell, ShellSelect.args(shell, source), { cwd: services.location.directory, stdin: "ignore" }), {
          combineOutput: true,
        })
        .pipe(
          Effect.map((result) => (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8")),
          Effect.mapError(
            (error) =>
              new EvaluationError({ command, message: `Shell interpolation failed for ${JSON.stringify(source)}: ${error.message}` }),
          ),
        )
    },
    { concurrency: 2 },
  )
  const iterator = outputs[Symbol.iterator]()
  return text.replace(shellRegex, () => iterator.next().value ?? "")
})

function parseArguments(input: string) {
  return (input.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))
}

function promptMessageText(content: unknown) {
  if (typeof content === "string") return content
  if (!content || typeof content !== "object") return ""
  if (!("type" in content) || content.type !== "text") return ""
  if (!("text" in content) || typeof content.text !== "string") return ""
  return content.text
}

function mcpCommandName(server: string, prompt: string) {
  return `${sanitize(server)}:${sanitize(prompt)}`
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
const shellRegex = /!`([^`]+)`/g

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [MCP.node, EventV2.node, AppProcess.node, Config.node, Location.node],
})
