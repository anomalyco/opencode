export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Shell as ShellSchema } from "@opencode/schema/shell"
import type { Tool } from "@opencode/schema/tool"
import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect"
import { Detaching } from "../../detaching.js"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"
import { ToolInterrupted } from "../interrupted.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

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
const description = (shell?: string) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    "Commands accept an optional timeout, background commands have no timeout by default.",
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
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
  interrupted: Schema.optionalKey(Schema.Boolean),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

const resultMessages = (output: Output) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output) => {
  return {
    output,
    content: resultMessages(output).map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      ...(output.interrupted !== undefined ? { interrupted: output.interrupted } : {}),
    },
  }
}

const backgroundResult = (shellID: string, file: string) => ({
  output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
  shellID,
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
    const detaching = yield* Detaching.Service

    // A planned shutdown leaves commands that can outlive this server running for the next one.
    const leaveRunning = (id: ShellSchema.ID) => detaching.isDetaching() && shell.detachable(id)

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
        const waited = yield* jobs.wait({ id }).pipe(Effect.exit)
        // Teardown interrupts the job without settling it; its durable row is reported by the next server.
        if (Exit.isFailure(waited))
          return Cause.hasInterrupts(waited.cause) ? undefined : yield* Effect.failCause(waited.cause)
        const info = waited.value.info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text = output
          ? resultMessages(output).join("\n\n")
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

    // Settles an interrupted foreground call. The interrupt only reaches the step through ToolInterrupted.
    const interrupted = Effect.fnUntraced(function* (info: ShellSchema.Info, jobID: string) {
      if (leaveRunning(info.id)) {
        yield* jobs.background(jobID)
        yield* shell.timeout(info.id, 0).pipe(Effect.ignore)
        const output = backgroundResult(info.id, info.file)
        yield* ToolInterrupted.report(toolResult(output))
        return output
      }
      yield* shell.stop(info.id, "killed").pipe(Effect.ignore)
      const result = yield* shell.result(info)
      // The stopped job settles from the same exit; this only releases it.
      yield* jobs.cancel(jobID)
      const output = {
        ...ShellResult.interrupted(result),
        shellID: info.id,
        interrupted: true,
        status: "completed" as const,
      }
      yield* ToolInterrupted.report(toolResult(output))
      return output
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) =>
            // Uninterruptible from spawning to blocking, so an interrupt cannot orphan a started command:
            // it stops (or, while detaching, backgrounds) the command and settles the call with its output.
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const timeout = input.background === true ? (input.timeout ?? 0) : (input.timeout ?? DEFAULT_TIMEOUT_MS)
                let finalTimeout = timeout
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
                    }),
                )
                yield* context.progress({ shellID: info.id })

                const settled = yield* Deferred.make<Output>()
                const run = Effect.gen(function* () {
                  const result = yield* shell.result(info)
                  if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                  const output = ShellResult.output(result)
                  return {
                    ...output,
                    output: output.timeout
                      ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`
                      : output.output,
                    status: "completed" as const,
                  }
                }).pipe(
                  Effect.tap((output) => Deferred.succeed(settled, output)),
                  Effect.map((output) => resultMessages(output).join("\n\n")),
                  Effect.onInterrupt(() =>
                    leaveRunning(info.id) ? Effect.void : shell.stop(info.id, "killed").pipe(Effect.ignore),
                  ),
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
                  return backgroundResult(info.id, info.file)
                }

                const blocked = yield* restore(jobs.block({ id: job.id, sessionID: context.sessionID })).pipe(
                  Effect.exit,
                )
                if (Exit.isFailure(blocked)) {
                  if (Cause.hasInterrupts(blocked.cause)) return yield* interrupted(info, job.id)
                  return yield* Effect.failCause(blocked.cause)
                }
                const result = blocked.value
                if (result?.type === "backgrounded") {
                  yield* shell.timeout(info.id, 0)
                  yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                  return backgroundResult(info.id, info.file)
                }
                if (result?.info.status === "error")
                  return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
                if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

                return yield* Deferred.await(settled)
              }),
            ).pipe(
              Effect.map(toolResult),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
