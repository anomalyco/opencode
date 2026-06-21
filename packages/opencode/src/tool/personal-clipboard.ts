import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-clipboard.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("read", "write"),
  content: Schema.optional(Schema.String),
})

function clipboardRead(): Effect.Effect<string> {
  return Effect.gen(function* () {
    const os = process.platform
    let cmd: string
    let args: string[]
    if (os === "darwin") {
      cmd = "pbpaste"
      args = []
    } else if (os === "win32") {
      cmd = "powershell"
      args = ["-Command", "Get-Clipboard"]
    } else {
      cmd = "xclip"
      args = ["-o", "-selection", "clipboard"]
    }
    const { ChildProcessSpawner } = yield* Effect.promise(() => import("effect/unstable/process/ChildProcessSpawner"))
    const { Command } = yield* Effect.promise(() => import("effect/unstable/process/Command"))
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const proc = Command.make(cmd, args).pipe(Command.stdout("pipe"), Command.stderr("pipe"))
    const result = yield* spawner.spawn(proc)
    const output = yield* result.stdout
    return output ?? ""
  })
}

function clipboardWrite(content: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const os = process.platform
    let cmd: string
    let args: string[]
    if (os === "darwin") {
      cmd = "pbcopy"
      args = []
    } else if (os === "win32") {
      cmd = "powershell"
      args = ["-Command", `Set-Clipboard -Value '${content.replace(/'/g, "''")}'`]
    } else {
      cmd = "xclip"
      args = ["-selection", "clipboard"]
    }
    const { ChildProcessSpawner } = yield* Effect.promise(() => import("effect/unstable/process/ChildProcessSpawner"))
    const { Command } = yield* Effect.promise(() => import("effect/unstable/process/Command"))
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const proc = Command.make(cmd, args).pipe(Command.stdin("pipe"), Command.stderr("pipe"))
    const result = yield* spawner.spawn(proc)
    yield* result.stdin.write(content)
    yield* result.stdin.close()
  })
}

export const PersonalClipboardTool = Tool.define(
  "personal_clipboard",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          switch (params.action) {
            case "read": {
              const content = yield* clipboardRead()
              return {
                title: "Área de transferência",
                output: content.length > 0 ? content : "(clipboard is empty)",
              }
            }
            case "write": {
              if (params.content === undefined)
                return yield* Effect.fail(new Error("content is required for write action"))
              yield* clipboardWrite(params.content)
              return {
                title: "Área de transferência",
                output: `Wrote ${params.content.length} characters to clipboard.`,
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
