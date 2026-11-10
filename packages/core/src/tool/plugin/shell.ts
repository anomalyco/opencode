export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Shell as ShellSchema } from "@opencode/schema/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Option, Schema, Scope } from "effect"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
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

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
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

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(
      function* (
        sessionID: SessionSchema.ID,
        id: string,
        shellID: string,
        command: string,
        settled: Deferred.Deferred<Output>,
      ) {
        const info = (yield* jobs.wait({ id })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text = output
          ? (info.output ?? "")
          : info.status === "error"
            ? (info.error ?? "Command failed")
            : "Cancelled"
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID,
          description: command,
          ...ShellResult.notification({
            jobID: id,
            shellID,
            command,
            state: info.status,
            text,
            output,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    // Stops the command of a call the user asked to stop, and fails the call with the output so far. The command
    // stays observable, output file included.
    const cancelled = Effect.fnUntraced(function* (info: ShellSchema.Info, jobID: string) {
      yield* shell.stop(info.id, "killed").pipe(Effect.ignore)
      // The stop escalates to SIGKILL on its own; the session does not wait for that to settle the call.
      const result = yield* shell.result(info, { wait: INTERRUPT_WAIT })
      // The stopped job settles from the same exit; this only releases it.
      yield* jobs.cancel(jobID)
      return yield* new ToolFailure({
        message: ShellResult.interrupted(result),
        metadata: { interrupted: true, truncated: result.capture?.truncated ?? false, shellID: info.id },
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
                const info = yield* shell.create(
                  {
                    command: input.command,
                    cwd: input.workdir,
                    timeout,
                    shell: yield* compatibleShell,
                    metadata: { sessionID: context.sessionID },
                  },
                  (invocation) =>
                    Effect.gen(function* () {
                      invocation.env.AGENT = "1"
                      invocation.env.OPENCODE = "1"
                      invocation.env.AI_AGENT ||= "opencode"
                      invocation.env.OPENCODE_SESSION_ID = context.sessionID
                      finalTimeout = yield* restore(prepare(invocation, context))
                      if (autoBackground) invocation.timeout = 0
                    }),
                )
                yield* context.progress({ shellID: info.id })

                const settled = yield* Deferred.make<Output>()
                const run = Effect.gen(function* () {
                  const result = yield* shell.result(info)
                  if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                  return { ...ShellResult.output(result), status: "completed" as const }
                }).pipe(
                  Effect.tap((output) => Deferred.succeed(settled, output)),
                  Effect.map((output) => resultMessages(output, finalTimeout).join("\n\n")),
                  // Cancelling the job stops the command but keeps it, output file included.
                  Effect.onInterrupt(() => shell.stop(info.id, "killed").pipe(Effect.ignore)),
                )
                const job = yield* jobs.start({
                  // CodeMode children share a tool-call ID, but each shell must own its job.
                  id: info.id,
                  type: name,
                  title: info.command,
                  metadata: { sessionID: context.sessionID, shellID: info.id },
                  recovery: {
                    kind: "shell",
                    sessionID: context.sessionID,
                    shellID: info.id,
                    command: info.command,
                  },
                  run,
                })

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
                // A user's stop arrives through `cancel`; an interrupt (a server shutdown) cancels the job as before.
                const outcome = yield* restore(
                  Effect.raceFirst(
                    blocked.pipe(Effect.map((result) => ({ type: "settled" as const, result }))),
                    (context.cancel ?? Effect.never).pipe(Effect.as({ type: "cancelled" as const })),
                  ),
                ).pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
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
