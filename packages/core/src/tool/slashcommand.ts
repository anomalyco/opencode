import { Effect, Schema } from "effect"
import { Command } from "../command"
import * as Tool from "./tool"
import DESCRIPTION from "./slashcommand.txt"

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The name of the slash command to run, without the leading slash" }),
  arguments: Schema.optional(Schema.String).annotate({
    description: "Optional arguments string substituted into the command template",
  }),
})

const argsRegex = /(?:"[^"]*"|'[^']*'|[^\s"']+)/g
const placeholderRegex = /\$([1-9]\d*)/g
const quoteTrimRegex = /^["']|["']$/g

/**
 * Substitute an arguments string into a command template. Numbered
 * placeholders ($1, $2, ...) consume whitespace-separated arguments with the
 * last placeholder receiving all remaining arguments, $ARGUMENTS receives the
 * raw string, and templates without placeholders get the arguments appended.
 * Mirrors the substitution the session prompt path applies to slash commands.
 */
export function substitute(template: string, args: string) {
  const raw = args.match(argsRegex) ?? []
  const parts = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
  const placeholders = template.match(placeholderRegex) ?? []
  const last = placeholders.reduce((max, item) => Math.max(max, Number(item.slice(1))), 0)
  const numbered = template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    if (position - 1 >= parts.length) return ""
    if (position === last) return parts.slice(position - 1).join(" ")
    return parts[position - 1]
  })
  const expanded = numbered.replaceAll("$ARGUMENTS", args)
  if (placeholders.length === 0 && !template.includes("$ARGUMENTS") && args.trim()) {
    return expanded + "\n\n" + args
  }
  return expanded
}

export const SlashcommandTool = Tool.define(
  "slashcommand",
  Effect.gen(function* () {
    const commands = yield* Command.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const command = yield* commands.get(params.command)
          if (!command) {
            const names = (yield* commands.list()).map((item) => item.name).sort()
            throw new Error(`Unknown command "${params.command}". Available commands: ${names.join(", ") || "none"}`)
          }

          yield* ctx.ask({
            permission: "slashcommand",
            patterns: [params.command],
            always: [params.command],
            metadata: {},
          })

          const template = yield* Effect.promise(async () => command.template)
          const rendered = substitute(template, params.arguments ?? "").trim()
          const notes = [
            command.subtask
              ? "This command is marked subtask: true. Run the instructions below as a subtask via the task tool instead of executing them inline."
              : undefined,
            command.agent ? `This command prefers the "${command.agent}" agent.` : undefined,
          ].filter((note): note is string => note !== undefined)

          return {
            title: `/${params.command}`,
            output: [
              ...notes,
              `<command_instructions name="${command.name}">`,
              rendered,
              "</command_instructions>",
              command.subtask
                ? "Run the instructions above as a subtask via the task tool."
                : "Execute the instructions above as part of the current task.",
            ].join("\n"),
            metadata: {
              command: command.name,
              subtask: command.subtask ?? false,
            },
          }
        }),
    }
  }),
)
