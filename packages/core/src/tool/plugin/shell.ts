export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { ShellCreateBefore } from "@opencode-ai/plugin/effect/shell"
import type { Tool } from "@opencode-ai/schema/tool"
import { Effect, Schema, Scope } from "effect"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { LocationMutation } from "../../location-mutation.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { BackgroundNotice } from "../../session/background-notice.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. The notification will include the command's output. DO NOT run sleep commands or poll the output file to check for completion. You can read from the file when its current output would be useful, such as when inspecting logs from a background server. Otherwise, continue with other work or end your response."
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
      "Run the command in the background and return immediately. You will be notified when it completes. DO NOT poll its progress.",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  shellID: Schema.optionalKey(Schema.String),
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running", "stopped"])),
})

type Output = typeof Output.Type

const notice = (output: Output) => {
  if (output.status === "running") return BACKGROUND_INSTRUCTION
  if (output.status === "stopped") return ShellResult.stopped
  return ShellResult.notice({ status: output.timeout ? "timeout" : "exited", exit: output.exit })
}

const toolResult = (output: Output) => {
  return {
    output,
    content: [output.output, notice(output)].map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      truncated: output.truncated,
      ...(output.exit !== undefined ? { exit: output.exit } : {}),
      ...(output.timeout !== undefined ? { timeout: output.timeout } : {}),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
    },
  }
}

const completedResult = (outcome: ShellResult.Outcome): Output => ({
  output: outcome.output,
  truncated: outcome.truncated,
  ...(outcome.exit !== undefined ? { exit: outcome.exit } : {}),
  ...(outcome.status === "timeout" ? { timeout: true } : {}),
  status: outcome.status === "killed" ? "stopped" : "completed",
})

const backgroundResult = (shellID: string, file: string): Output => ({
  output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
  shellID,
  truncated: false,
  status: "running",
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const mutation = yield* LocationMutation.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const config = yield* Config.Service

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const source = {
        type: "tool" as const,
        messageID: context.messageID,
        id: context.id,
      }
      const target = yield* mutation.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const portable = Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner === true
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        mutation.resolve({
          path: LocationMutation.resolvePath(target.absolute, directory),
          kind: "directory",
        }),
      )
      const external = [target, ...directories]
        .map((item) => item.externalDirectory)
        .filter((item) => item !== undefined)
        .filter((item, index, items) => items.findIndex((other) => other.resource === item.resource) === index)
      if (external.length > 0)
        yield* permission.assert({
          action: "external_directory",
          resources: external.map((item) => item.resource),
          save: external.map((item) => item.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
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
      function* (recovery: Extract<Job.Recovery, { kind: "shell" }>) {
        const info = (yield* jobs.wait({ id: recovery.shellID })).info
        if (!info || info.status === "running") return
        yield* BackgroundNotice.deliver(sessions, jobs, { ...info, recovery })
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) =>
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
                    finalTimeout = yield* prepare(invocation, context)
                  }),
              )
              const recovery = {
                kind: "shell" as const,
                sessionID: context.sessionID,
                shellID: info.id,
                command: info.command,
              }
              // The shell's own terminal state is the job's result; nothing here reclassifies it.
              const run = shell.result(info).pipe(
                Effect.map((result) => {
                  const outcome = ShellResult.outcome(result)
                  if (outcome.status !== "timeout") return outcome
                  return {
                    ...outcome,
                    output: `${outcome.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                  }
                }),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* jobs.start({
                // CodeMode children share a tool-call ID, but each shell must own its job.
                id: info.id,
                type: name,
                title: info.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                recovery,
                run,
              })
              // Once the job owns the shell, interruption anywhere before block/background cancels through it.
              yield* context
                .progress({ shellID: info.id })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))

              if (input.background === true) {
                yield* jobs.background(job.id)
                yield* notifyWhenDone(recovery)
                return backgroundResult(info.id, info.file)
              }

              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0).pipe(Effect.ignore)
                yield* notifyWhenDone(recovery)
                return backgroundResult(info.id, info.file)
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.result?.kind !== "shell") return yield* Effect.fail(new Error("Command cancelled"))
              return completedResult(result.info.result)
            }).pipe(
              Effect.map(toolResult),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell))
      }),
    )
  }),
}
