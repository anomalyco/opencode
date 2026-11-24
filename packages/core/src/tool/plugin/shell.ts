export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Shell as ShellSchema } from "@opencode/schema/shell"
import type { Tool } from "@opencode/schema/tool"
import { Clock, Deferred, Duration, Effect, Fiber, Option, Schema, Stream, Struct } from "effect"
import { Agent } from "../../agent.js"
import { Bus } from "../../bus.js"
import { CodeModeJob } from "../../codemode/job.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Environment } from "../../environment/index.js"
import { Flag } from "../../flag.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellPermissions } from "../../shell/permissions.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"
import { toolFailure } from "../runtime.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
const CODE_MODE_TIMEOUT_MS = 10 * 60 * 1_000
// In full Code Mode, how long a call waits before returning while its command keeps running.
export const DEFAULT_YIELD_MS = 30 * 1_000
const YIELD_TAIL_BYTES = 6_000
export const readName = "shell_read"
const READ_WAIT_MS = 30 * 1_000
export const READ_MAX_WAIT_MS = 5 * 60 * 1_000
const READ_LIMIT_BYTES = 64 * 1_024
// How long a call the user interrupted waits for its stopped command to exit before settling with the output so far.
const INTERRUPT_WAIT = "500 millis"

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. The notification will include the command's output. Unless the user explicitly asks otherwise, DO NOT poll for completion, even if you need the final result to continue. Repeatedly sleeping and reading or searching the output file is polling, not useful work. You may read the current output if it lets you do useful work now, but do not repeatedly check it while waiting for the command to finish. Keep working on anything that does not depend on the result. If you have nothing else to do, end your response; you will be resumed automatically when the command finishes."
const OS =
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : process.platform === "linux"
        ? "Linux"
        : process.platform
const description = (shell?: string, codeMode = false) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    // Code Mode has no background parameter.
    ...(codeMode
      ? [
          `A command still running after \`yield_ms\` (default ${DEFAULT_YIELD_MS}) returns its \`shellID\`, the output so far and \`outputPath\`, and keeps running; \`yield_ms: 0\` waits until it exits.`,
          `\`tools.${readName}({shellID})\` returns its new output, and its exit code once it exits. Nothing is reported automatically when it exits.`,
          "`timeout` stops the command when it expires.",
          "Every result has `outputPath`, the file with its full output.",
        ]
      : [
          "Commands still running after their timeout move to the background.",
          "Background commands return immediately, and you will be notified when they complete.",
        ]),
    "The current session ID is available in the OPENCODE_SESSION_ID environment variable.",
  ].join(" ")

const timeoutInput = (foreground: number) =>
  Schema.optionalKey(NonNegativeInt).annotate({
    description: `Optional timeout in milliseconds (default ${foreground}). When it expires, a foreground command moves to the background and a background command is stopped.`,
  })

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
  }),
  timeout: timeoutInput(DEFAULT_TIMEOUT_MS),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
  }),
})

const CodeModeInput = Schema.Struct({
  ...Struct.omit(Input.fields, ["background"]),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: "Optional limit in milliseconds; the command is stopped when it expires.",
  }),
  yield_ms: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Milliseconds to wait before returning while the command keeps running (default ${DEFAULT_YIELD_MS}); 0 waits until it exits.`,
  }),
})

// Keys other harnesses' shells take that change nothing about how the command runs, so dropping them is harmless.
const IGNORED_KEYS = new Set(["description"])

/**
 * The `<tool-repair>` note for a full Code Mode shell call with keys its input doesn't take, which then doesn't run:
 * silently dropping `background` or `run_in_background` would block on what was meant to run alongside.
 */
export const unknownInputRepair = (dropped: ReadonlyArray<string>) => {
  const keys = dropped.filter((key) => !IGNORED_KEYS.has(key))
  if (keys.length === 0) return undefined
  return [
    "<tool-repair>",
    `tools.shell takes only ${Object.keys(CodeModeInput.fields)
      .map((key) => `\`${key}\``)
      .join(", ")} in Code Mode, so this call with ${keys.map((key) => `\`${key}\``).join(", ")} did not run.`,
    `A command still running after \`yield_ms\` returns its \`shellID\` and keeps running; read it with tools.${readName}. To run a whole script in the background, use execute's \`background\` option; to wait longer for one, give execute a longer \`timeout\`.`,
    "</tool-repair>",
  ].join("\n")
}

const StructuredOutput = Schema.Struct({
  shellID: Schema.optionalKey(Schema.String).annotate({
    description:
      "Present only while the command is still running in the background. You will be notified when it exits. A result without shellID is final.",
  }),
  exitCode: Schema.NullOr(Schema.Number).annotate({
    description:
      "The exit code once the command has exited: 0 means success. null while it is still running, or when a signal ended it.",
  }),
  signal: Schema.optionalKey(Schema.String).annotate({ description: "The signal that ended the command, if any" }),
  killed: Schema.optionalKey(Schema.String).annotate({
    description:
      "Why the command ended without an exit code, when the reason is known: the machine's worker restarted or lost the process, or the local process daemon stopped",
  }),
  outputPath: Schema.optionalKey(Schema.String).annotate({
    description: "File with the full output, when output was truncated or the command is running in the background",
  }),
  pid: Schema.optionalKey(NonNegativeInt).annotate({
    description: "Process ID while the command is running in the background",
  }),
  wallTimeSeconds: Schema.Number.annotate({ description: "Seconds since the command started" }),
  output: Schema.String.annotate({
    description:
      "Combined stdout and stderr as one string; there are no separate stdout or stderr fields. While shellID is present it is a notice instead, and the output streams to outputPath.",
  }),
})

const CodeModeOutput = Schema.Struct({
  ...StructuredOutput.fields,
  shellID: Schema.optionalKey(Schema.String).annotate({
    description: `Present only while the command is still running; read it with tools.${readName}. A result without shellID is final.`,
  }),
  killed: Schema.optionalKey(Schema.String).annotate({
    description:
      "Why the command ended without an exit code, when the reason is known: its timeout expired, the machine's worker restarted or lost the process, or the local process daemon stopped",
  }),
  outputPath: Schema.String.annotate({ description: "File with the full output" }),
})

const ReadInput = Schema.Struct({
  shellID: Schema.String.annotate({ description: "The `shellID` of a command that is still running" }),
  wait_ms: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Longest to wait for the command to exit (default ${READ_WAIT_MS}, at most ${READ_MAX_WAIT_MS})`,
  }),
})

const ReadOutput = Schema.Struct({
  shellID: Schema.String,
  running: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number).annotate({ description: "null while running, or when a signal ended it" }),
  signal: Schema.optionalKey(Schema.String),
  output: Schema.String.annotate({ description: "Output since the previous read" }),
  outputPath: Schema.String.annotate({ description: "File with the full output" }),
})

type Output = ReturnType<typeof ShellResult.output> & {
  status: "completed" | "running"
  wallTimeSeconds: number
  outputPath?: string
  shellID?: string
  pid?: number
}

// A yielded command's output already ends with how to follow it.
const resultMessages = (output: Output, timeout?: number, yielded = false) => {
  const notice =
    output.status === "running" ? (yielded ? undefined : BACKGROUND_INSTRUCTION) : ShellResult.notice(output, timeout)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output, timeout?: number, fullCodeMode = false) => {
  return {
    output: {
      ...Struct.omit(output, ["exit", "status", "truncated", "timeout"]),
      exitCode: output.exit ?? null,
      // In full Code Mode a timeout only ever stops the command.
      ...(fullCodeMode && output.timeout && output.killed === undefined
        ? { killed: `Stopped when its timeout${timeout ? ` of ${timeout / 1_000} seconds` : ""} expired.` }
        : {}),
    },
    content: resultMessages(output, timeout, fullCodeMode).map((text) => ({
      type: "text" as const,
      text,
    })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      ...(output.pid !== undefined ? { pid: output.pid } : {}),
    },
  }
}

const wallTimeSeconds = (time: ShellSchema.Time, end: number) => Math.max(0, end - time.started) / 1_000

const backgroundText = (info: ShellSchema.Info, timeout?: number) =>
  [
    `Command moved to the background (shell ID: ${info.id}).`,
    ...(info.pid === undefined ? [] : [`PID: ${info.pid}`]),
    `Output is streaming to: ${info.file}`,
    ...(timeout === undefined
      ? []
      : [
          "",
          `The command did not finish within its timeout of ${timeout / 1_000} seconds and was moved to the background. Do not start another copy while it is running.`,
        ]),
  ].join("\n")

const backgroundResult = (info: ShellSchema.Info, now: number, timeout?: number) => ({
  output: backgroundText(info, timeout),
  wallTimeSeconds: wallTimeSeconds(info.time, now),
  shellID: info.id,
  outputPath: info.file,
  ...(info.pid === undefined ? {} : { pid: info.pid }),
  truncated: false,
  status: "running" as const,
})

// Tells the session how a background command ended, once its job settles.
const notify = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  jobs: Job.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly id: string
    readonly shellID: string
    readonly command: string
    readonly settled: Deferred.Deferred<Output>
  },
) {
  const info = (yield* jobs.wait({ id: input.id })).info
  if (!info || info.status === "running") return
  // `shell_read` already returned this result.
  if (!(yield* jobs.deliver(input.id)))
    return info.notificationID ? yield* jobs.completeBackground(info.notificationID) : undefined
  const output = info.status === "completed" ? yield* Deferred.await(input.settled) : undefined
  const text = output ? (info.output ?? "") : info.status === "error" ? (info.error ?? "Command failed") : "Cancelled"
  // A session deleted while its command ran has no one left to tell.
  yield* sessions
    .synthetic({
      ...(info.notificationID ? { id: info.notificationID } : {}),
      sessionID: input.sessionID,
      description: input.command,
      ...ShellResult.notification({
        jobID: input.id,
        shellID: input.shellID,
        command: input.command,
        state: info.status,
        text,
        output,
      }),
    })
    .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void))
  if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
})

// Waits for the command to end and reads what it printed.
const finished = Effect.fnUntraced(function* (shell: Shell.Interface, info: ShellSchema.Info) {
  const result = yield* shell.result(info)
  if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
  const completed = result.info.time.completed ?? (yield* Clock.currentTimeMillis)
  return {
    ...ShellResult.output(result),
    status: "completed" as const,
    wallTimeSeconds: wallTimeSeconds(result.info.time, completed),
    ...(result.capture.truncated ? { outputPath: result.info.file } : {}),
  }
})

// The job that waits on a command for its call (or its session, once backgrounded).
const startJob = Effect.fnUntraced(function* (
  jobs: Job.Interface,
  shell: Shell.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly info: ShellSchema.Info
    readonly background?: boolean
    readonly notificationID?: SessionMessage.ID
    readonly timeout?: () => number
  },
) {
  const info = input.info
  const settled = yield* Deferred.make<Output>()
  const job = yield* jobs.start({
    // CodeMode children share a tool-call ID, but each shell must own its job.
    id: info.id,
    type: name,
    title: info.command,
    metadata: { sessionID: input.sessionID, shellID: info.id },
    recovery: {
      kind: "shell",
      sessionID: input.sessionID,
      shellID: info.id,
      command: info.command,
    },
    ...(input.notificationID ? { notificationID: input.notificationID } : {}),
    background: input.background,
    run: finished(shell, info).pipe(
      Effect.tap((output) => Deferred.succeed(settled, output)),
      Effect.map((output) => resultMessages(output, input.timeout?.()).join("\n\n")),
      // Interrupting the job (its registry closing) stops the command too, unless the server is handing its daemon
      // over: then the command keeps running for the next server.
      Effect.onInterrupt(() =>
        shell.handoffPrepared() ? Effect.void : shell.stop(info.id, "killed").pipe(Effect.ignore, Effect.asVoid),
      ),
    ),
    // Cancelling the job stops the command, keeping it and its output file.
    cancel: shell.stop(info.id, "killed").pipe(Effect.ignore, Effect.asVoid),
  })
  return { job, settled }
})

/** The tool result of a call whose command moved to the background. */
export const backgroundToolResult = (info: ShellSchema.Info) => {
  // Narrowed to what a backgrounded command reports, so it can be published as is.
  const metadata = {
    shellID: info.id,
    status: "running" as const,
    truncated: false,
    ...(info.pid === undefined ? {} : { pid: info.pid }),
  }
  return {
    content: [backgroundText(info), BACKGROUND_INSTRUCTION].map((text) => ({
      type: "text" as const,
      text,
    })),
    metadata,
  }
}

/**
 * Watches a command taken over from a previous server as a background job of its session, and notifies the
 * session when it finishes, as for a command the model ran in the background. A finished command's notice is
 * admitted before this returns.
 */
export const reattach = Effect.fnUntraced(function* (input: {
  readonly shell: Shell.Interface
  readonly jobs: Job.Interface
  readonly sessions: Pick<Session.Interface, "synthetic">
  readonly sessionID: SessionSchema.ID
  readonly info: ShellSchema.Info
  // The job's existing durable row, if the previous server had backgrounded it.
  readonly notificationID?: SessionMessage.ID
}) {
  const { job, settled } = yield* startJob(input.jobs, input.shell, { ...input, background: true })
  const notifying = notify(input.sessions, input.jobs, {
    sessionID: input.sessionID,
    id: job.id,
    shellID: input.info.id,
    command: input.info.command,
    settled,
  })
  const current = yield* input.shell.get(input.info.id).pipe(Effect.option)
  if (Option.isSome(current) && current.value.status !== "running")
    return yield* notifying.pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to report a recovered shell command", { id: input.info.id, error }),
      ),
    )
  yield* input.shell.watch(notifying)
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const jobs = yield* Job.Service
    const access = yield* FileAccess.Service
    const currentWorkingDirectory = yield* Environment.workingDirectoryResolver
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const config = yield* Config.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service

    const prepare = Effect.fn("ShellTool.prepare")(function* (
      invocation: ShellCreateBefore,
      context: Tool.Context,
      requested: { readonly cwd: string; readonly target: FileAccess.Target },
    ) {
      const workingDirectory = yield* currentWorkingDirectory
      // Resolved before the hooks ran; only a hook that moved the working directory needs it resolved again. It always
      // resolves from a base, so a moved path is a plain path on the machine the command was asked for.
      const target =
        invocation.cwd === requested.cwd
          ? requested.target
          : yield* access.resolve({
              path: invocation.cwd,
              base:
                requested.target.environment.id === workingDirectory.environment.id
                  ? workingDirectory
                  : requested.target,
              kind: "directory",
            })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const requests = yield* ShellPermissions.requests(access, {
        command: invocation.command,
        program: invocation.shell,
        target,
        policy: Effect.gen(function* () {
          const session = yield* sessions.get(context.sessionID)
          const agent = yield* agents.resolve(context.agent)
          return Permission.Policy.fromRules(agent?.permissions ?? [], session.permissions ?? [])
        }),
      })
      yield* Effect.forEach(
        requests,
        (request) => permission.assert({ ...request, ...Permission.invocation(context) }),
        { discard: true },
      )
      // Approval can outlive the directory, so validate immediately before spawning.
      const workdir = yield* Environment.typeFollowing(target.environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(
            new Error(
              target.machine === undefined
                ? `Working directory does not exist: ${target.absolute}`
                : `Working directory does not exist on ${target.machine}: ${target.absolute}`,
            ),
          ),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return timeout
    })

    // Not in this Location's scope: a daemon command outlives a Location that closes while the server runs, and
    // its session must still hear how it ended.
    const notifyWhenDone = (
      sessionID: SessionSchema.ID,
      id: string,
      shellID: string,
      command: string,
      settled: Deferred.Deferred<Output>,
    ) => shell.watch(notify(sessions, jobs, { sessionID, id, shellID, command, settled }))

    // A yielded command reports nothing when it exits, so the model isn't woken for each one: `shell_read` picks up
    // its result. Only its outbox row goes, so a restart doesn't replay it.
    const settleQuietly = (id: string) =>
      shell.watch(
        Effect.gen(function* () {
          const info = (yield* jobs.wait({ id })).info
          if (!info || info.status === "running" || !info.notificationID) return
          yield* jobs.completeBackground(info.notificationID)
        }),
      )

    // Where `shell_read` continues from, by shell.
    const cursors = new Map<string, number>()

    // A yielded command: the end of its output so far, and how to follow the rest.
    const yielded = Effect.fnUntraced(function* (info: ShellSchema.Info, after: number) {
      const size = (yield* shell.output(info.id, { limit: 0 }).pipe(Effect.orElseSucceed(() => ({ size: 0 })))).size
      const start = Math.max(0, size - YIELD_TAIL_BYTES)
      const page = yield* shell
        .output(info.id, { cursor: start, limit: YIELD_TAIL_BYTES })
        .pipe(Effect.orElseSucceed(() => ({ output: "", cursor: size })))
      cursors.set(info.id, page.cursor)
      const notice = `[Still running after ${after / 1_000}s as shell ${info.id}${info.pid === undefined ? "" : ` (PID ${info.pid})`}; its full output streams to ${info.file}. Read its new output and exit code with tools.${readName}({shellID: "${info.id}"}). Nothing is reported when it exits. Don't start another copy.]`
      const tail = page.output.replace(/\n$/, "")
      return {
        output: [
          ...(start > 0 ? [`[${start} earlier bytes are in outputPath]`] : []),
          ...(tail ? [tail, ""] : []),
          notice,
        ].join("\n"),
        wallTimeSeconds: wallTimeSeconds(info.time, yield* Clock.currentTimeMillis),
        shellID: info.id,
        outputPath: info.file,
        ...(info.pid === undefined ? {} : { pid: info.pid }),
        truncated: false,
        status: "running" as const,
      }
    })

    const read = Effect.fn("ShellTool.read")(function* (input: typeof ReadInput.Type, context: Tool.Context) {
      const id = input.shellID as ShellSchema.ID
      const found = yield* shell.get(id).pipe(Effect.option)
      if (Option.isNone(found) || found.value.metadata.sessionID !== context.sessionID)
        return yield* new ToolFailure({ message: `${input.shellID} is not a shell command of this session.` })
      const wait = Math.min(input.wait_ms ?? READ_WAIT_MS, READ_MAX_WAIT_MS)
      // Waits for the command's job when it has one, so the exit it sees is the job's: holding the job's notification
      // meanwhile, and taking its result once finished, so a pushed command read here isn't notified again.
      const job = yield* jobs.get(id)
      const until: Effect.Effect<unknown, unknown> = job?.status === "running" ? jobs.wait({ id }) : shell.wait(id)
      // The calling script keeps blocking while this waits, instead of moving to the background.
      yield* jobs
        .collect(
          job ? [id] : [],
          found.value.status === "running" && wait > 0
            ? until.pipe(Effect.timeoutOption(Duration.millis(wait)), Effect.ignore)
            : Effect.void,
        )
        .pipe((yield* CodeModeJob.Extend)(wait))
      const info = yield* shell.get(id).pipe(Effect.orElseSucceed(() => found.value))
      const running = info.status === "running"
      const cursor = cursors.get(id) ?? 0
      const page = yield* shell
        .output(id, { cursor, limit: READ_LIMIT_BYTES })
        .pipe(Effect.orElseSucceed(() => ({ output: "", cursor, size: cursor })))
      cursors.set(id, page.cursor)
      const rest = page.size - page.cursor
      const output = {
        shellID: info.id,
        running,
        exitCode: info.exit ?? null,
        ...(info.signal === undefined ? {} : { signal: info.signal }),
        output: rest > 0 ? `${page.output}\n[${rest} more bytes: read again, or read outputPath]` : page.output,
        outputPath: info.file,
      }
      const state = running
        ? "Still running."
        : `Exited with code ${info.exit ?? `null (${info.signal ?? info.status})`}.`
      return {
        output,
        content: [{ type: "text" as const, text: output.output ? `${state}\n${output.output}` : state }],
        metadata: {},
      }
    })

    // Stops the command of a call the user asked to stop, and fails the call with the output so far. The command
    // stays observable, output file included.
    const cancelled = Effect.fnUntraced(function* (info: ShellSchema.Info, jobID: string) {
      yield* shell.stop(info.id, "killed").pipe(Effect.ignore)
      // The stop escalates to SIGKILL on its own; the session does not wait for that to settle the call.
      const result = yield* shell.result(info, { wait: INTERRUPT_WAIT })
      // The stopped job settles from the same exit; this only releases it.
      yield* jobs.cancel(jobID)
      const stopped = ShellResult.interrupted(result)
      return yield* new ToolFailure({
        message: stopped.message,
        // The notice ends the message; renderers show what precedes it as the output, like a finished call's.
        metadata: {
          interrupted: true,
          truncated: result.capture?.truncated ?? false,
          shellID: info.id,
          notice: stopped.notice,
        },
      })
    })

    // The descriptions name the selected shell, so they're rebuilt whenever it changes.
    const bus = yield* Bus.Service
    yield* bus.subscribe(ShellSelect.Event.Updated).pipe(
      Stream.runForEach(() => ctx.tool.reload()),
      Effect.forkScoped({ startImmediately: true }),
    )
    const runSync = Effect.runSyncWith(yield* Effect.context())
    yield* ctx.tool
      .transform((editor) => {
        // Named in both the direct and the Code Mode description, so a model knows the shell either way.
        const shellName = ShellSelect.name(runSync(compatibleShell))
        const full = flags.resolve(loaded.entries).full_codemode.enabled
        if (full)
          editor.add({
            name: readName,
            // Pinned so a script reads a yielded command with it instead of polling. Hidden wherever shell is denied.
            options: { permission: name, codemode: { pinned: true } },
            description:
              "Return a still-running shell command's output since the last read, waiting up to `wait_ms` for it to exit. Once it has exited, `running` is false and `exitCode` is set.",
            input: ReadInput,
            output: ReadOutput,
            execute: read,
          })
        editor.add({
          name,
          // With full_codemode, shell is allowed in Code Mode and pinned so the catalog always lists it.
          options: full
            ? {
                codemode: {
                  pinned: true,
                  description: description(shellName, true),
                  input: CodeModeInput,
                  output: CodeModeOutput,
                },
              }
            : { codemode: false },
          description: description(shellName),
          input: Input,
          output: StructuredOutput,
          execute: (input, context) => {
            // In full Code Mode a command's timeout stops it, and `yield_ms` returns the call while it keeps running.
            const fullCodeMode = full && context.codemode === true
            const yields = fullCodeMode && context.automation === undefined
            const yieldMs = yields
              ? "yield_ms" in input && typeof input.yield_ms === "number"
                ? input.yield_ms
                : DEFAULT_YIELD_MS
              : 0
            // Code Mode input has no background parameter.
            const background = "background" in input && input.background === true
            // A direct foreground timeout of 0 falls back to the default, so a call can't block until the command exits.
            const foreground = input.timeout || (context.codemode ? CODE_MODE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
            const timeout = background || yields ? (input.timeout ?? 0) : foreground
            let finalTimeout = timeout
            // Uninterruptible from spawning to blocking, so an interrupt cannot orphan a started command.
            return Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                // Listens for the user's stop for the whole call, starting before the command does, so a stop always
                // reaches this tool through `cancel` instead of interrupting it, even while the command starts.
                const stopped = yield* Deferred.make<void>()
                const listener = context.cancel
                  ? yield* context.cancel.pipe(
                      Effect.andThen(Deferred.succeed(stopped, undefined)),
                      Effect.interruptible,
                      Effect.forkChild({ startImmediately: true }),
                    )
                  : undefined
                // Raced against the slow work that precedes the command, so a stop then ends the call at once.
                const stoppedBeforeStart = Deferred.await(stopped).pipe(
                  Effect.andThen(
                    Effect.fail(new ToolFailure({ message: "Command interrupted by the user before it started." })),
                  ),
                )
                // An automation's code has nobody to hear how a backgrounded command ends. There a timeout stops the
                // command and fails the call, and the command gets no job the session could move to the background or
                // be told about.
                const timeoutBackgrounds = !background && !yields && context.automation === undefined
                return yield* Effect.gen(function* () {
                  const workingDirectory = yield* currentWorkingDirectory
                  // The same default `Shell.create` gives the hooks, so `prepare` can tell whether one moved it.
                  const cwd = input.workdir ?? workingDirectory.absolute
                  const target = yield* restore(
                    Effect.raceFirst(
                      access.resolve({
                        path: cwd,
                        base: input.workdir === undefined ? workingDirectory : undefined,
                        kind: "directory",
                      }),
                      stoppedBeforeStart,
                    ),
                  )
                  const info = yield* shell.create(
                    {
                      command: input.command,
                      cwd,
                      // The environment a command runs in is settled from the requested working directory, before
                      // hooks run. A hook may move the directory; today that cannot change the environment.
                      environment: target.environment,
                      timeout,
                      shell: yield* compatibleShell,
                      metadata: { sessionID: context.sessionID },
                      waited: timeoutBackgrounds,
                      toolCall: {
                        sessionID: context.sessionID,
                        assistantMessageID: context.messageID,
                        callID: context.id,
                      },
                    },
                    (invocation) =>
                      Effect.gen(function* () {
                        invocation.env.AGENT = "1"
                        invocation.env.OPENCODE = "1"
                        invocation.env.AI_AGENT ||= "opencode"
                        invocation.env.OPENCODE_SESSION_ID = context.sessionID
                        // Asking for permission can take a while; a stop then ends the call before any command starts.
                        finalTimeout = yield* restore(
                          Effect.raceFirst(prepare(invocation, context, { cwd, target }), stoppedBeforeStart),
                        )
                        // A foreground timeout moves the command to the background instead of stopping it.
                        if (timeoutBackgrounds) invocation.timeout = 0
                      }),
                  )
                  yield* context.progress({ shellID: info.id })

                  if (context.automation) {
                    const output = yield* restore(finished(shell, info)).pipe(
                      Effect.onInterrupt(() => shell.stop(info.id, "killed").pipe(Effect.ignore)),
                    )
                    if (output.timeout)
                      return yield* new ToolFailure({ message: resultMessages(output, finalTimeout).join("\n\n") })
                    return fullCodeMode ? { ...output, outputPath: info.file } : output
                  }

                  const { job, settled } = yield* startJob(jobs, shell, {
                    sessionID: context.sessionID,
                    info,
                    timeout: () => finalTimeout,
                  })
                  // Stopped while the command was starting: stop it now.
                  if (yield* Deferred.isDone(stopped)) return yield* cancelled(info, job.id)

                  if (background) {
                    yield* jobs.background(job.id)
                    yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                    return backgroundResult(info, yield* Clock.currentTimeMillis)
                  }

                  const waiting = jobs.block({ id: job.id, sessionID: context.sessionID })
                  const returnAfter = yields ? yieldMs : finalTimeout
                  const blocked =
                    returnAfter > 0
                      ? waiting.pipe(
                          Effect.timeoutOption(returnAfter),
                          Effect.flatMap((result) =>
                            Option.isSome(result)
                              ? Effect.succeed(result.value)
                              : jobs
                                  .background(job.id)
                                  .pipe(
                                    Effect.map((info) =>
                                      info ? { type: "backgrounded" as const, info, timedOut: true } : undefined,
                                    ),
                                  ),
                          ),
                        )
                      : waiting
                  // A user's stop arrives through `cancel`. Any interrupt stops the command too, unless the server is
                  // handing its daemon over: then the command and its job keep running, and the next server takes the
                  // call over and moves the command to the background.
                  const outcome = yield* restore(
                    Effect.raceFirst(
                      blocked.pipe(Effect.map((result) => ({ type: "settled" as const, result }))),
                      Deferred.await(stopped).pipe(Effect.as({ type: "cancelled" as const })),
                    ),
                  ).pipe(
                    Effect.onInterrupt(() =>
                      shell.handoffPrepared() ? Effect.void : jobs.cancel(job.id).pipe(Effect.ignore),
                    ),
                  )
                  if (outcome.type === "cancelled") return yield* cancelled(info, job.id)
                  const result = outcome.result
                  if (result?.type === "backgrounded" && yields) {
                    yield* settleQuietly(job.id)
                    return yield* yielded(info, yieldMs)
                  }
                  if (result?.type === "backgrounded") {
                    yield* shell.timeout(info.id, 0)
                    const elapsed = "timedOut" in result ? finalTimeout : undefined
                    finalTimeout = 0
                    yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                    return backgroundResult(info, yield* Clock.currentTimeMillis, elapsed)
                  }
                  const where = fullCodeMode ? `\nFull output: ${info.file}` : ""
                  if (result?.info.status === "error")
                    return yield* Effect.fail(new Error(`${result.info.error ?? "Command failed"}${where}`))
                  if (result?.info.status === "cancelled")
                    return yield* Effect.fail(new Error(`Command cancelled${where}`))

                  const output = yield* Deferred.await(settled)
                  return fullCodeMode ? { ...output, outputPath: info.file } : output
                }).pipe(Effect.ensuring(listener ? Fiber.interrupt(listener) : Effect.void))
              }),
            ).pipe(
              // Shell spans, including the job that waits for a backgrounded command, name the call that started them.
              Effect.annotateSpans({
                "gen_ai.tool.call.id": context.id,
                ...(background ? { "opencode.shell.background": true } : {}),
              }),
              Effect.map((output) => toolResult(output, finalTimeout, fullCodeMode)),
              Effect.mapError(toolFailure(`Unable to execute command: ${input.command}`)),
            )
          },
        })
      })
      .pipe(Effect.orDie)
  }),
}
