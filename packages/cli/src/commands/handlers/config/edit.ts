import path from "path"
import { existsSync } from "fs"
import { Effect, Exit, Option, Schema } from "effect"
import { applyEdits, modify } from "jsonc-parser"
import { isRecord } from "@/util/record"
import { UI } from "../../ui"
import { effectCmd, fail } from "../../effect-cmd"

/** Split a dot path into jsonc-parser segments; numeric segments address array elements. */
export function segments(dotted: string) {
  return dotted.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

/** Parse a CLI value: JSON when valid, raw string otherwise. */
export function value(text: string): unknown {
  const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(text)
  return Option.isSome(parsed) ? parsed.value : text
}

/** Apply one set/unset edit to JSON(C) text, preserving comments and formatting. */
export function edit(text: string, dotted: string, next: unknown) {
  return applyEdits(
    text,
    modify(text, segments(dotted), next, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  )
}

/** Read a dot path from a resolved config object. */
export function select(config: unknown, dotted: string) {
  return dotted.split(".").reduce((current: unknown, part) => {
    if (Array.isArray(current)) return current[Number(part)]
    if (isRecord(current)) return current[part]
    return undefined
  }, config)
}

export const GetCommand = effectCmd({
  command: "get <key>",
  describe: "print the resolved config value at a dot path",
  builder: (yargs) =>
    yargs.positional("key", {
      type: "string",
      demandOption: true,
      describe: "dot path, e.g. model or provider.anthropic.options.baseURL",
    }),
  handler: Effect.fn("Cli.config.get")(function* (args) {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((svc) => svc.get())
    const found = select(config, args.key)
    if (found === undefined) return yield* fail(`No value at "${args.key}"`)
    UI.println(typeof found === "string" ? found : JSON.stringify(found, null, 2))
  }),
})

export const SetCommand = effectCmd({
  command: "set <key> <value>",
  describe: "write a config value at a dot path (comments in .jsonc files are preserved)",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", demandOption: true, describe: "dot path, e.g. model" })
      .positional("value", {
        type: "string",
        demandOption: true,
        describe: "value; parsed as JSON when valid, raw string otherwise",
      })
      .option("global", { type: "boolean", default: false, describe: "write to the global config file" }),
  handler: Effect.fn("Cli.config.set")(function* (args) {
    const { ConfigV1 } = yield* Effect.promise(() => import("@bolt-ai/core/v1/config/config"))
    const { ConfigParse } = yield* Effect.promise(() => import("@/config/parse"))
    const target = yield* file(args.global)
    const text = yield* content(target)
    const decode = Schema.decodeUnknownExit(ConfigV1.Info)
    // Prefer the JSON-decoded value, but fall back to the raw string when only the raw
    // string fits the schema, so `set username 1234` stays a string.
    const candidates = [value(args.value), args.value].filter(
      (candidate, index, all) => index === 0 || candidate !== all[0],
    )
    const chosen =
      candidates.find((candidate) =>
        Exit.isSuccess(decode(ConfigParse.jsonc(edit(text, args.key, candidate), target), { errors: "all" })),
      ) ?? candidates[0]
    const updated = edit(text, args.key, chosen)
    yield* validate(updated, target)
    yield* Effect.promise(() => Bun.write(target, updated))
    UI.println(`Set ${args.key} = ${JSON.stringify(chosen)} in ${target}`)
  }),
})

export const UnsetCommand = effectCmd({
  command: "unset <key>",
  describe: "remove a config value at a dot path (comments in .jsonc files are preserved)",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", demandOption: true, describe: "dot path, e.g. model" })
      .option("global", { type: "boolean", default: false, describe: "edit the global config file" }),
  handler: Effect.fn("Cli.config.unset")(function* (args) {
    const target = yield* file(args.global)
    const text = yield* content(target)
    const { ConfigParse } = yield* Effect.promise(() => import("@/config/parse"))
    if (select(ConfigParse.jsonc(text, target), args.key) === undefined) {
      return yield* fail(`Nothing set at "${args.key}" in ${target}`)
    }
    const updated = edit(text, args.key, undefined)
    yield* validate(updated, target)
    yield* Effect.promise(() => Bun.write(target, updated))
    UI.println(`Unset ${args.key} in ${target}`)
  }),
})

// Resolve the file to edit: the global config, the nearest project config file, or a fresh
// bolt.jsonc at the worktree root when the project has none yet.
const file = Effect.fnUntraced(function* (global: boolean) {
  const { Config } = yield* Effect.promise(() => import("@/config/config"))
  if (global) return Config.globalConfigFile()
  const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
  const { ConfigPaths } = yield* Effect.promise(() => import("@/config/paths"))
  const ctx = yield* InstanceRef
  if (!ctx) return yield* fail("Could not load instance context")
  const bolt = yield* ConfigPaths.files("bolt", ctx.directory, ctx.worktree).pipe(Effect.orDie)
  // files() returns root-first, so the last entry is nearest to the working directory.
  return bolt.at(-1) ?? bolt.at(-1) ?? path.join(ctx.worktree ?? ctx.directory, "bolt.jsonc")
})

const content = Effect.fnUntraced(function* (target: string) {
  if (!existsSync(target)) return "{}"
  const text = yield* Effect.promise(() => Bun.file(target).text())
  return text.trim() ? text : "{}"
})

// Throws ConfigInvalidError with actionable issues when the edited file no longer fits the
// schema; the top-level CLI error formatter renders it.
const validate = Effect.fnUntraced(function* (text: string, target: string) {
  const { ConfigV1 } = yield* Effect.promise(() => import("@bolt-ai/core/v1/config/config"))
  const { ConfigParse } = yield* Effect.promise(() => import("@/config/parse"))
  ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(text, target), target)
})
