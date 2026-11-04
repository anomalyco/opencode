import path from "node:path"
import { log, select, text } from "@clack/prompts"
import { Effect, Schema } from "effect"
import { Form } from "@opencode/schema/form"
import { prompt } from "../../../ui/prompt"
import { answerForm } from "../auth/form"

const Setup = Schema.Struct({
  fields: Schema.optional(Form.Fields),
  secrets: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        title: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      }),
    ),
  ),
})

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    opencode: Schema.optional(
      Schema.Struct({ experimental: Schema.optional(Schema.Struct({ setup: Schema.optional(Schema.String) })) }),
    ),
  }),
)

export async function readSetup(directory: string) {
  const reference = Schema.decodeUnknownSync(Manifest)(await Bun.file(path.join(directory, "package.json")).text())
    .opencode?.experimental?.setup
  if (reference === undefined) return undefined
  // Resolve the declaration from the installed package, not the user's working directory.
  const setup = Schema.decodeUnknownSync(Schema.fromJsonString(Setup))(
    await Bun.file(path.resolve(directory, reference)).text(),
  )
  const keys = [...(setup.fields ?? []), ...(setup.secrets ?? [])].map((field) => field.key)
  if (new Set(keys).size !== keys.length) throw new Error("Plugin setup field keys must be unique")
  return setup
}

export const setupPlugin = Effect.fn("cli.plugin.setup")(function* (directory: string) {
  const setup = yield* Effect.tryPromise(() => readSetup(directory))
  if (!setup) {
    log.info("This plugin does not declare setup questions")
    return undefined
  }
  log.info("Plugin setup answers are saved in your global configuration. Use secret references for credentials.")
  const options = (yield* answerForm(setup.fields)) ?? {}
  for (const field of setup.secrets ?? []) {
    if (field.description) log.info(field.description)
    const source = yield* prompt<"env" | "file">(() =>
      select({
        message: `${field.title ?? field.key}: secret source`,
        options: [
          { value: "env", label: "Environment variable" },
          { value: "file", label: "Existing secret file" },
        ],
      }),
    )
    const value = yield* prompt<string>(() =>
      text({
        message: source === "env" ? "Environment variable name" : "Secret file path",
        validate: (value) => {
          if (!value?.trim()) return "Required"
          if (source === "env" && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return "Enter a variable name, not its value"
          if (value.includes("}")) return "References cannot contain }"
        },
      }),
    )
    // Resolve relative secret paths here, not from the global config directory.
    options[field.key] = `{${source}:${source === "file" && !value.startsWith("~/") ? path.resolve(value) : value}}`
    if (source === "env") log.info(`Make ${value} available to the OpenCode server; setup does not set it for you.`)
  }
  return options
})
