export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Shell as ShellSchema } from "@opencode/schema/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Fiber, Option, Schema } from "effect"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"
import { toolFailure } from "../runtime.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
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
const description = (shell?: string, autoBackground = false) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    autoBackground
      ? "Commands still running after their timeout move to the background."
      : "Commands accept an optional timeout, background commands have no timeout by default.",
    "Background commands return immediately, and you will be notified when they complete.",
  ].join(" ")

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
  }),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${DEFAULT_TIMEOUT_MS} for foreground commands. Background commands have no timeout by default.`,
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  pid: Schema.optionalKey(NonNegativeInt),
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
  killed: Schema.optionalKey(Schema.String),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

const resultMessages = (output: Output, timeout?: number) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output, timeout)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output, timeout?: number) => {
  return {
    output,
    content: resultMessages(output, timeout).map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      ...(output.pid !== undefined ? { pid: output.pid } : {}),
    },
  }
}

const backgroundResult = (info: ShellResult.Result["info"], timeout?: number) => ({
  output: [
    `Command moved to the background (shell ID: ${info.id}).`,
    ...(info.pid === undefined ? [] : [`PID: ${info.pid}`]),
    `Output is streaming to: ${info.file}`,
    ...(timeout === undefined
      ? []
      : [
          "",
          `The command did not finish within its timeout of ${timeout / 1_000} seconds and was moved to the background. Do not start another copy while it is running.`,
        ]),
  ].join("\n"),
  shellID: info.id,
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
    run: Effect.gen(function* () {
      const result = yield* shell.result(info)
      if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
      return { ...ShellResult.output(result), status: "completed" as const }
    }).pipe(
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
  const result = toolResult(backgroundResult(info))
  // Narrowed to what a backgrounded command reports, so it can be published as is.
  const metadata = {
    shellID: info.id,
    status: "running" as const,
    truncated: result.metadata.truncated,
    ...(info.pid === undefined ? {} : { pid: info.pid }),
  }
  return { content: result.content, metadata }
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
    const jobs = yield* Job.Service
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const autoBackground = yield* Flag.enabled("shell_timeout_background")

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute)
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({
          path: FileAccess.resolvePath(target.absolute, directory),
          kind: "directory",
        }),
      )
      yield* access.authorizeExternal([target, ...directories], context)
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          ...Permission.invocation(context),
        })
      // Approval can outlive the directory, so validate immediately before spawning.
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
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

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(undefined, autoBackground),
          input: Input,
          output: Output,
          execute: (input, context) => {
            const timeout = input.background === true ? (input.timeout ?? 0) : (input.timeout ?? DEFAULT_TIMEOUT_MS)
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
                return yield* Effect.gen(function* () {
                  const info = yield* shell.create(
                    {
                      command: input.command,
                      cwd: input.workdir,
                      timeout,
                      shell: yield* compatibleShell,
                      metadata: { sessionID: context.sessionID },
                      waited: input.background !== true,
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
                          Effect.raceFirst(
                            prepare(invocation, context),
                            Deferred.await(stopped).pipe(
                              Effect.andThen(
                                Effect.fail(
                                  new ToolFailure({ message: "Command interrupted by the user before it started." }),
                                ),
                              ),
                            ),
                          ),
                        )
                        if (autoBackground) invocation.timeout = 0
                      }),
                  )
                  yield* context.progress({ shellID: info.id })

                  const { job, settled } = yield* startJob(jobs, shell, {
                    sessionID: context.sessionID,
                    info,
                    timeout: () => finalTimeout,
                  })
                  // Stopped while the command was starting: stop it now.
                  if (yield* Deferred.isDone(stopped)) return yield* cancelled(info, job.id)

                  if (input.background === true) {
                    yield* jobs.background(job.id)
                    yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                    return backgroundResult(info)
                  }

                  const waiting = jobs.block({ id: job.id, sessionID: context.sessionID })
                  const blocked =
                    autoBackground && finalTimeout > 0
                      ? waiting.pipe(
                          Effect.timeoutOption(finalTimeout),
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
                  if (result?.type === "backgrounded") {
                    yield* shell.timeout(info.id, 0)
                    const elapsed = "timedOut" in result ? finalTimeout : undefined
                    finalTimeout = 0
                    yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                    return backgroundResult(info, elapsed)
                  }
                  if (result?.info.status === "error")
                    return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
                  if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

                  return yield* Deferred.await(settled)
                }).pipe(Effect.ensuring(listener ? Fiber.interrupt(listener) : Effect.void))
              }),
            ).pipe(
              // Shell spans, including the job that waits for a backgrounded command, name the call that started them.
              Effect.annotateSpans({
                "gen_ai.tool.call.id": context.id,
                ...(input.background === true ? { "opencode.shell.background": true } : {}),
              }),
              Effect.map((output) => toolResult(output, finalTimeout)),
              Effect.mapError(toolFailure(`Unable to execute command: ${input.command}`)),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell), autoBackground)
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
