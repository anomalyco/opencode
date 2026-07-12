export * as TuiConfig from "./tui-config"

import { Global } from "@opencode-ai/core/global"
import { TuiConfig } from "@opencode-ai/tui/config/v1"
import { Effect, FileSystem, Option, Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import path from "path"

export const load = Effect.fn("TuiConfig.load")(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const filepath = path.join(global.config, "tui.json")
  const text = yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!text) return TuiConfig.resolve({}, { terminalSuspend: process.platform !== "win32" })

  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) return TuiConfig.resolve({}, { terminalSuspend: process.platform !== "win32" })

  return TuiConfig.resolve(
    Option.getOrElse(Schema.decodeUnknownOption(TuiConfig.Info)(input), () => ({})),
    { terminalSuspend: process.platform !== "win32" },
  )
})
