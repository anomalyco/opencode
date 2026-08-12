export * as ShellTool from "./shell.js"

import path from "path"
import { ToolFailure } from "@opencode-ai/ai"
import type { Content } from "@opencode-ai/schema/tool"
import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { Deferred, Effect, Schema, Scope } from "effect"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { LocationMutation } from "../../location-mutation.js"
import { Permission } from "../../permission.js"
import { PluginRuntime } from "../../plugin/runtime.js"
import { NonNegativeInt } from "../../schema.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ToolOutput } from "../../tool-output.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

const BACKGROUND_STARTED = "The command was moved to the background."
const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. DO NOT sleep, poll, or proactively check on its progress."
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
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

const modelOutput = (output: Output): string | undefined => {
  if (output.status === "running") return BACKGROUND_INSTRUCTION
  if (output.timeout) return "Command timed out before completion."
  return `Command exited with code ${output.exit}.`
}

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: PluginContext) {
    const runtime = yield* PluginRuntime.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const mutation = yield* LocationMutation.Service
    const shell = yield* Shell.Service
    const permission = yield* Permission.Service
    const config = yield* Config.Service

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(function* (
      sessionID: SessionSchema.ID,
      id: string,
      command: string,
    ) {
      yield* runtime.job.wait({ id: id }).pipe(
        Effect.flatMap((result) => {
          const state =
            result.info?.status === "completed"
              ? "completed"
              : result.info?.status === "error"
                ? "error"
                : result.info?.status === "cancelled"
                  ? "cancelled"
                  : undefined
          if (state === undefined) return Effect.void
          const text =
            state === "completed"
              ? (result.info!.output ?? "")
              : state === "error"
                ? (result.info!.error ?? "Command failed")
                : "Command cancelled"
          return runtime.session.synthetic({
            sessionID,
            text: `<shell id="${id}" state="${state}" command="${command}">\n${text}\n</shell>`,
            description: command,
            metadata: { source: "shell", state },
          })
        }),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false },
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              const timeout = input.background === true ? (input.timeout ?? 0) : (input.timeout ?? DEFAULT_TIMEOUT_MS)
              let finalTimeout = timeout
              const info = yield* shell.create(
                {
                  command: input.command,
                  cwd: input.workdir,
                  timeout,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    const target = yield* mutation.resolve({ path: invocation.cwd, kind: "directory" })
                    const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute)
                    const directories = yield* Effect.forEach(parsed.directories, (directory) =>
                      mutation.resolve({ path: path.resolve(target.absolute, directory), kind: "directory" }),
                    )
                    invocation.cwd = target.absolute
                    finalTimeout = invocation.timeout
                    const external = [target, ...directories]
                      .map((item) => item.externalDirectory)
                      .filter((item) => item !== undefined)
                      .filter(
                        (item, index, items) => items.findIndex((other) => other.resource === item.resource) === index,
                      )
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
                    const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
                      Effect.catchTag("Environment.NotFound", () =>
                        Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
                      ),
                    )
                    if (workdir !== "directory")
                      return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
                  }),
              )
              yield* context.progress({ shellID: info.id })

              const captureShell = Effect.fn("ShellTool.captureShell")(function* () {
                const configured = Config.latest(yield* config.entries(), "tool_output")
                const maxLines = configured?.max_lines ?? ToolOutput.MAX_LINES
                const maxBytes = configured?.max_bytes ?? ToolOutput.MAX_BYTES
                const latest = yield* shell.output(info.id, { cursor: Number.MAX_SAFE_INTEGER })
                const page = yield* shell.output(info.id, {
                  cursor: Math.max(0, latest.size - maxBytes),
                  limit: maxBytes,
                })
                const lines = page.output.split("\n")
                if (page.output.endsWith("\n")) lines.pop()
                const truncated = latest.size > maxBytes || lines.length > maxLines
                const output = lines.length > maxLines ? lines.slice(-maxLines).join("\n") : page.output
                const notice = truncated ? `\n\n[output truncated; full output saved to: ${info.file}]` : ""
                return {
                  output: `${output || "(no output)"}${notice}`,
                  truncated,
                }
              })

              const settleShell = Effect.fn("ShellTool.settleShell")(function* () {
                const final = yield* shell.wait(info.id)
                const capture = yield* captureShell()

                // `exit` is optionalKey in the Output schema; a present-but-undefined key
                // fails output encoding, so omit it when the process has no exit code.
                if (final.status === "timeout") {
                  return {
                    ...(final.exit !== undefined ? { exit: final.exit } : {}),
                    output: `${capture.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                    truncated: capture.truncated,
                    timeout: true,
                    status: "completed" as const,
                  }
                }

                return {
                  ...(final.exit !== undefined ? { exit: final.exit } : {}),
                  output: capture.output,
                  truncated: capture.truncated,
                  status: "completed" as const,
                }
              })

              const settled = yield* Deferred.make<Output>()
              const run = settleShell().pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => output.output),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* runtime.job.start({
                id: context.id,
                type: name,
                title: info.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                run,
              })

              if (input.background === true) {
                yield* runtime.job.background(job.id)
                yield* notifyWhenDone(context.sessionID, context.id, info.command)
                return {
                  output: BACKGROUND_STARTED,
                  shellID: info.id,
                  truncated: false,
                  status: "running" as const,
                }
              }

              const result = yield* runtime.job
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => runtime.job.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
                yield* notifyWhenDone(context.sessionID, context.id, info.command)
                return {
                  output: BACKGROUND_STARTED,
                  shellID: info.id,
                  truncated: false,
                  status: "running" as const,
                }
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

              return yield* Deferred.await(settled)
            }).pipe(
              Effect.map((output) => {
                const content: Array<Content> = [{ type: "text", text: output.output }]
                const model = modelOutput(output)
                if (model) content.push({ type: "text", text: model })
                return {
                  output,
                  content,
                  metadata: {
                    truncated: output.truncated,
                    ...("exit" in output && output.exit !== undefined ? { exit: output.exit } : {}),
                    ...("shellID" in output && output.shellID !== undefined ? { shellID: output.shellID } : {}),
                    ...("timeout" in output && output.timeout !== undefined ? { timeout: output.timeout } : {}),
                  },
                }
              }),
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
        tool.description = description(yield* shell.name())
      }),
    )
  }),
}
