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
    Effect.tryPromise({
      try: async () => {
        const file = path.join(directory, name)
        const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        })
        if (text === undefined) return undefined
        const errors: ParseError[] = []
        const value: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) throw new Error(`Invalid global configuration: ${file}`)
        if (!isRecord(value) || !isRecord(value.experimental) || !("sandbox" in value.experimental)) return undefined
        return Schema.decodeUnknownSync(ConfigExperimental.Sandbox, { onExcessProperty: "error" })(value.experimental.sandbox)
      },
      catch: (cause) => new Error(`Unable to read sandbox configuration from ${path.join(directory, name)}: ${cause}`),
    }),
  )
  return files.reduce<typeof ConfigExperimental.Sandbox.Type>((result, file) => ({ ...result, ...file }), {})
})
