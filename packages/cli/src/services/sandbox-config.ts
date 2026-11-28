export * as SandboxConfig from "./sandbox-config"

import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { isRecord } from "@opencode/util/record"
import { Effect, Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import fs from "node:fs/promises"
import path from "node:path"

// Server authority comes only from global configuration, never project documents.
export const read = Effect.fn("cli.sandbox-config.read")(function* (directory: string) {
  const files = yield* Effect.forEach(["opencode.json", "opencode.jsonc"], (name) =>
    Effect.gen(function* () {
      const file = path.join(directory, name)
      const text = yield* Effect.tryPromise(() => fs.readFile(file, "utf8")).pipe(
        Effect.catch((error) => {
          const cause = error.cause
          if (isRecord(cause) && cause.code === "ENOENT") return Effect.undefined
          return Effect.logWarning("Unable to read global configuration", { file }).pipe(Effect.as(undefined))
        }),
      )
      if (text === undefined) return
      const errors: ParseError[] = []
      const value: unknown = parse(text, errors, { allowTrailingComma: true })
      const sandbox =
        isRecord(value) && isRecord(value.experimental) && isRecord(value.experimental.sandbox)
          ? value.experimental.sandbox
          : undefined
      if (!errors.length) return sandbox
      if (sandbox?.enabled === true) return yield* Effect.fail(new Error(`Invalid global configuration: ${file}`))
      yield* Effect.logWarning("Ignoring malformed global configuration", { file })
    }),
  )
  const settings = files.reduce<Record<string, unknown>>((result, file) => ({ ...result, ...file }), {})
  const choice = files.findLast((file) => typeof file?.enabled === "boolean")
  if (choice?.enabled !== true) return {}
  return yield* Schema.decodeUnknownEffect(ConfigExperimental.Sandbox, { onExcessProperty: "error" })(settings).pipe(
    Effect.mapError((cause) => new Error(`Invalid enabled shell sandbox configuration: ${cause}`)),
  )
})
