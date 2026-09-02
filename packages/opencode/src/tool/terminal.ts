import { Effect, Schema } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Pty } from "@opencode-ai/core/pty"
import { PtyID } from "@opencode-ai/core/pty/schema"
import { ShellID } from "./shell/id"
import * as Tool from "./tool"
import DESCRIPTION from "./terminal.txt"

type Cell = {
  cursor: number
}

type Snapshot = {
  output: string
  exited: boolean
  exitCode?: number
}

export const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["open", "input", "read", "close"])),
  command: Schema.optional(Schema.String).annotate({
    description:
      'The interactive command to run in a new terminal (only for action "open"). For example: ssh user@host',
  }),
  ptyID: Schema.optional(PtyID).annotate({
    description: 'The ptyID of an existing interactive session (required for actions "input", "read", and "close").',
  }),
  data: Schema.optional(Schema.String).annotate({
    description: 'Keystrokes to send to the running command (only for action "input").',
  }),
  enter: Schema.optional(Schema.Boolean).annotate({
    description: 'When true (action "input"), append a newline after data to submit the prompt.',
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: 'Working directory for a new terminal (action "open"). Defaults to the project root.',
  }),
  shell: Schema.optional(Schema.Literals(["powershell", "cmd", "bash"])).annotate({
    description:
      'The shell to run the command in (action "open"). Defaults to PowerShell on Windows and bash elsewhere. "bash" uses the default shell on POSIX.',
  }),
})

export const TerminalTool = Tool.define(
  "terminal",
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Map<string, Cell>>(() => Effect.succeed(new Map()))
    const locations = yield* LocationServiceMap.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const cells = yield* InstanceState.get(state)
          const location = Location.Ref.make({ directory: AbsolutePath.make(ins.directory) })
          const scoped = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(Effect.provide(locations.get(location)))

          const readMore = Effect.fnUntraced(function* (id: PtyID) {
            const from = cells.get(id)?.cursor ?? 0
            const attachment = yield* scoped(
              Pty.Service.use((service) =>
                service.attach(id, {
                  cursor: from,
                  onData: () => {},
                  onEnd: () => {},
                }),
              ),
            ).pipe(
              Effect.catchTag("Pty.ExitedError", () => Effect.succeed(undefined)),
              Effect.catchTag("Pty.NotFoundError", () => Effect.succeed(undefined)),
            )
            if (!attachment) {
              const info = yield* scoped(Pty.Service.use((service) => service.get(id))).pipe(
                Effect.catchTag("Pty.NotFoundError", () => Effect.succeed(undefined)),
              )
              if (!info) return { output: "Terminal session no longer exists.", exited: true }
              cells.delete(id)
              return { output: "", exited: true, exitCode: info.exitCode }
            }
            const replay = attachment.replay
            cells.set(id, { cursor: attachment.cursor })
            attachment.detach()
            return { output: replay || "(no new output)", exited: false }
          })

          const action = params.action ?? "open"

          if (action === "open") {
            const command = params.command
            if (!command) throw new Error('terminal "open" requires a `command`')
            yield* ctx.ask({
              permission: ShellID.ToolID,
              patterns: [command],
              always: [command],
              metadata: { command, interactive: true },
            })
            const cwd = params.workdir ? path.resolve(ins.directory, params.workdir) : ins.directory
            // Pty sessions launch an executable file plus args; run the free-form
            // command string through a shell. Default to PowerShell on Windows and
            // bash elsewhere, but let the model pick cmd/powershell/bash explicitly.
            const win = process.platform === "win32"
            const kind = params.shell ?? (win ? "powershell" : "bash")
            const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
            const shell =
              kind === "bash" && !win
                ? (process.env.SHELL ?? "/bin/bash")
                : kind === "cmd"
                  ? path.join(systemRoot, "System32", "cmd.exe")
                  : path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
            const args =
              kind === "bash" && !win
                ? ["-lc", command]
                : kind === "cmd"
                  ? ["/d", "/s", "/c", command]
                  : ["-NoLogo", "-NoProfile", "-Command", command]
            const info = yield* scoped(Pty.Service.use((service) => service.create({ command: shell, args, cwd })))
            const attachment = yield* scoped(
              Pty.Service.use((service) =>
                service.attach(info.id, {
                  cursor: 0,
                  onData: () => {},
                  onEnd: () => {},
                }),
              ),
            )
            const initial = attachment.replay
            cells.set(info.id, { cursor: attachment.cursor })
            attachment.detach()
            return {
              title: command,
              metadata: { ptyID: info.id, status: "running" },
              output: initial || `Interactive terminal started. ptyID: ${info.id}.`,
            }
          }

          const id = params.ptyID
          if (!id) throw new Error(`terminal "${action}" requires a \`ptyID\``)

          if (action === "close") {
            yield* scoped(Pty.Service.use((service) => service.remove(id))).pipe(
              Effect.catchTag("Pty.NotFoundError", () => Effect.void),
            )
            cells.delete(id)
            return {
              title: "terminal close",
              metadata: { ptyID: id, status: "closed" },
              output: `Terminal session ${id} closed.`,
            }
          }

          if (action === "input") {
            const data = params.data ?? ""
            if (!data && !params.enter) throw new Error('terminal "input" requires `data` or `enter: true`')
            // Windows consoles expect CR (not LF) to submit a line; normalize any
            // \n / \r\n the model sends so keystrokes never appear "lost".
            const send = data.replace(/\r?\n/g, "\r") + (params.enter ? "\r" : "")
            yield* scoped(Pty.Service.use((service) => service.write(id, send)))
            // Give the PTY a moment to echo/produce output before reading so the
            // result doesn't seem to be missing.
            yield* Effect.sleep("120 millis")
            const next = yield* readMore(id)
            return {
              title: "terminal input",
              metadata: { ptyID: id, status: next.exited ? "exited" : "running" },
              output: next.output,
            }
          }

          const next = yield* readMore(id)
          return {
            title: "terminal read",
            metadata: { ptyID: id, status: next.exited ? "exited" : "running" },
            output: next.output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
