import { Effect, Schema, Stream } from "effect"
import path from "path"
import * as Tool from "./tool"
import { BackgroundJob } from "@/background/job"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Identifier } from "@bolt-ai/core/id/id"
import { Shell } from "@bolt-ai/core/shell"
import { ShellID } from "./shell/id"
import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import START_DESCRIPTION from "./background.txt"
import OUTPUT_DESCRIPTION from "./background-output.txt"
import KILL_DESCRIPTION from "./background-kill.txt"
import LIST_DESCRIPTION from "./background-list.txt"
import STDIN_DESCRIPTION from "./background-stdin.txt"

const TYPE = "shell"

/** Live output per running job. BackgroundJob only exposes output after completion, so the
 * stream consumer inside each job's run effect appends here and process_output reads it. */
const live = new Map<string, { text: string; cut: boolean }>()

/** Handle per running job so background_stdin can write to the child's stdin. */
const handles = new Map<string, ChildProcessHandle>()

function append(id: string, chunk: string, keep: number) {
  const entry = live.get(id) ?? { text: "", cut: false }
  entry.text += chunk
  if (entry.text.length > keep) {
    entry.text = entry.text.slice(entry.text.length - keep)
    entry.cut = true
  }
  live.set(id, entry)
}

// stdin stays piped and open (endOnDone: false) so background_stdin can write
// to the child across multiple calls; programs that ignore stdin are unaffected.
function command(shell: string, text: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", text], {
      cwd,
      env,
      stdin: { stream: "pipe", endOnDone: false },
      detached: false,
    })
  }
  return ChildProcess.make(text, [], {
    shell,
    cwd,
    env,
    stdin: { stream: "pipe", endOnDone: false },
    detached: process.platform !== "win32",
  })
}

/** Encode a background_stdin write; appends a newline unless enter is false. */
export function payload(data: string, enter?: boolean) {
  const text = enter === false ? data : `${data}\n`
  return new TextEncoder().encode(text)
}

function render(info: BackgroundJob.Info) {
  const meta = info.metadata ?? {}
  const cmd = typeof meta.command === "string" ? meta.command : (info.title ?? "")
  return `${info.id} [${info.status}] ${cmd}`
}

export const StartParameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The shell command to run in the background" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory for the command. Defaults to the project directory.",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Short human-readable label for the process (e.g. 'dev server')",
  }),
})

export const BackgroundStartTool = Tool.define(
  "bash_background",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const spawner = yield* ChildProcessSpawner
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const trunc = yield* Truncate.Service

    return {
      description: START_DESCRIPTION,
      parameters: StartParameters,
      execute: (params: Schema.Schema.Type<typeof StartParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.command.trim()) throw new Error("command is required")
          const instance = yield* InstanceState.context
          const cwd = params.workdir ? path.resolve(instance.directory, params.workdir) : instance.directory

          // Same permission action as the foreground shell tool so existing bash
          // allow/deny rules apply to background commands too.
          const tokens = params.command.trim().split(/\s+/)
          yield* ctx.ask({
            permission: ShellID.ToolID,
            patterns: [params.command],
            always: [BashArity.prefix(tokens).join(" ") + " *"],
            metadata: {
              command: params.command,
              background: true,
            },
          })

          const cfg = yield* config.get()
          const shell = Shell.acceptable(cfg.shell)
          const extra = yield* plugin.trigger(
            "shell.env",
            { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
            { env: {} },
          )
          const env = { ...process.env, ...extra.env }
          const limits = yield* trunc.limits()
          const keep = limits.maxBytes * 2

          // Generate the id up front so the run effect can key its live output buffer.
          const id = Identifier.ascending("job")
          const info = yield* jobs.start({
            id,
            type: TYPE,
            title: params.title ?? params.command,
            metadata: {
              sessionId: ctx.sessionID,
              parentSessionId: ctx.sessionID,
              background: true,
              command: params.command,
              cwd,
            },
            run: Effect.scoped(
              Effect.gen(function* () {
                const handle = yield* spawner.spawn(command(shell, params.command, cwd, env))
                handles.set(id, handle)
                yield* Effect.addFinalizer(() => Effect.sync(() => handles.delete(id)))
                yield* Effect.forkScoped(
                  Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                    Effect.sync(() => append(id, chunk, keep)),
                  ),
                )
                const code = yield* handle.exitCode.pipe(
                  Effect.onInterrupt(() =>
                    handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.catch(() => Effect.void)),
                  ),
                )
                const entry = live.get(id)
                live.delete(id)
                const text = entry?.text ?? ""
                return `exit=${code}\n${text}`
              }),
            ),
          })

          return {
            title: params.title ?? params.command,
            output: [
              `Started background process ${info.id}: ${params.command}`,
              `Use process_output with id=${info.id} to read its output, and kill_process to stop it.`,
            ].join("\n"),
            metadata: { id: info.id, status: info.status },
          }
        }),
    }
  }),
)

export const OutputParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The background process id returned by bash_background" }),
  wait: Schema.optional(Schema.Number).annotate({
    description: "Optional milliseconds to wait for the process to finish before returning",
  }),
})

export const BackgroundOutputTool = Tool.define(
  "process_output",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const trunc = yield* Truncate.Service

    return {
      description: OUTPUT_DESCRIPTION,
      parameters: OutputParameters,
      execute: (params: Schema.Schema.Type<typeof OutputParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.wait !== undefined && params.wait > 0) {
            yield* jobs.wait({ id: params.id, timeout: params.wait })
          }
          const info = yield* jobs.get(params.id)
          if (!info || info.type !== TYPE) {
            throw new Error(`No background process found with id ${params.id}. Use list_processes to see known ids.`)
          }
          const entry = live.get(params.id)
          const text = info.status === "running" ? (entry?.text ?? "") : (info.output ?? info.error ?? "")
          const limits = yield* trunc.limits()
          const cut = (entry?.cut ?? false) || text.length > limits.maxBytes
          const body = text.length > limits.maxBytes ? text.slice(text.length - limits.maxBytes) : text
          return {
            title: `${params.id} [${info.status}]`,
            output: [`status=${info.status}`, body || "(no output yet)"].join("\n"),
            metadata: { id: info.id, status: info.status, truncated: cut },
          }
        }),
    }
  }),
)

export const StdinParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The background process id returned by bash_background" }),
  data: Schema.String.annotate({ description: "The text to write to the process's stdin" }),
  enter: Schema.optional(Schema.Boolean).annotate({
    description: "Append a trailing newline so line-buffered programs see the input. Defaults to true.",
  }),
})

export const BackgroundStdinTool = Tool.define(
  "background_stdin",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service

    return {
      description: STDIN_DESCRIPTION,
      parameters: StdinParameters,
      execute: (params: Schema.Schema.Type<typeof StdinParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* jobs.get(params.id)
          if (!info || info.type !== TYPE) {
            throw new Error(`No background process found with id ${params.id}. Use list_processes to see known ids.`)
          }
          if (info.status !== "running") {
            throw new Error(`Process ${params.id} has already exited (status=${info.status}); its stdin is closed.`)
          }
          const handle = handles.get(params.id)
          if (!handle) {
            throw new Error(`Process ${params.id} is not accepting input; its stdin pipe is already closed.`)
          }
          const bytes = payload(params.data, params.enter)
          yield* Stream.run(Stream.make(bytes), handle.stdin).pipe(
            Effect.catch((error) =>
              Effect.die(
                new Error(`Could not write to stdin of process ${params.id}; the pipe is closed (${error.message}).`),
              ),
            ),
          )
          return {
            title: `${params.id} stdin`,
            output: `Wrote ${bytes.byteLength} bytes to stdin of ${params.id}. Use process_output with id=${params.id} to read its response.`,
            metadata: { id: params.id, bytes: bytes.byteLength },
          }
        }),
    }
  }),
)

export const KillParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The background process id to terminate" }),
})

export const BackgroundKillTool = Tool.define(
  "kill_process",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service

    return {
      description: KILL_DESCRIPTION,
      parameters: KillParameters,
      execute: (params: Schema.Schema.Type<typeof KillParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const found = yield* jobs.get(params.id)
          if (!found || found.type !== TYPE) {
            throw new Error(`No background process found with id ${params.id}. Use list_processes to see known ids.`)
          }
          const info = (yield* jobs.cancel(params.id)) ?? found
          live.delete(params.id)
          return {
            title: `${params.id} [${info.status}]`,
            output: `Process ${params.id} is now ${info.status}.`,
            metadata: { id: info.id, status: info.status },
          }
        }),
    }
  }),
)

export const ListParameters = Schema.Struct({})

export const BackgroundListTool = Tool.define(
  "list_processes",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service

    return {
      description: LIST_DESCRIPTION,
      parameters: ListParameters,
      execute: (_params: Schema.Schema.Type<typeof ListParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const list = (yield* jobs.list()).filter((info) => info.type === TYPE)
          if (list.length === 0) {
            return {
              title: "No background processes",
              output: "No background processes have been started in this session.",
              metadata: { count: 0 },
            }
          }
          return {
            title: `${list.length} background process${list.length === 1 ? "" : "es"}`,
            output: list.map(render).join("\n"),
            metadata: { count: list.length },
          }
        }),
    }
  }),
)
