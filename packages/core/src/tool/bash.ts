export * as BashTool from "./bash"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PositiveInt } from "../schema"
import { ToolOutputStore } from "../tool-output-store"
import { ToolRegistry } from "../tool-registry"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS)).pipe(Schema.optional).annotate({
    description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
  }),
  description: Schema.String.pipe(Schema.optional).annotate({
    description: "Concise description of the command's purpose",
  }),
})

const Success = Schema.Struct({
  command: Schema.String,
  cwd: Schema.String,
  exitCode: Schema.Number.pipe(Schema.optional),
  /** Bounded compact equivalent of stdout/stderr: stderr is labeled when present. */
  output: Schema.String,
  truncated: Schema.Boolean,
  stdoutTruncated: Schema.Boolean.pipe(Schema.optional),
  stderrTruncated: Schema.Boolean.pipe(Schema.optional),
  resource: ToolOutputStore.Resource.pipe(Schema.optional),
  timedOut: Schema.Boolean.pipe(Schema.optional),
})

type Success = typeof Success.Type

const defaultShell = () => process.platform === "win32" ? process.env.COMSPEC ?? "cmd.exe" : "/bin/sh"

const compactOutput = (stdout: string, stderr: string) => {
  const output = stdout && stderr ? `${stdout}\n\nstderr:\n${stderr}` : stderr ? `stderr:\n${stderr}` : stdout
  return output || "(no output)"
}

const captureNotice = (stdoutTruncated: boolean, stderrTruncated: boolean) => {
  if (stdoutTruncated && stderrTruncated) return "[stdout and stderr capture truncated at the in-memory safety limit]"
  if (stdoutTruncated) return "[stdout capture truncated at the in-memory safety limit]"
  if (stderrTruncated) return "[stderr capture truncated at the in-memory safety limit]"
}

const modelOutput = (output: Success) => {
  if (output.timedOut) return `${output.output}\n\nCommand timed out before completion.`
  return `${output.output}\n\nCommand exited with code ${output.exitCode}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

const definition = Tool.make({
  description: `Execute one shell command string. The active Location is the default working directory. Relative workdir values resolve from that Location. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: modelOutput(output) })],
})

/**
 * Minimal V2 core shell boundary. Keep parity debt visible without pulling the
 * legacy shell runtime into core.
 */
// TODO: Port tree-sitter bash / PowerShell parser-based approval reduction.
// TODO: Port BashArity reusable command-prefix approvals.
// TODO: Discover command argument paths and request external_directory for external argument targets, not only cwd.
// TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
// TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const mutation = yield* LocationMutation.Service
    const appProcess = yield* AppProcess.Service
    const resources = yield* ToolOutputStore.Service
    const config = yield* Config.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID, call, assertPermission }) =>
          Effect.gen(function* () {
            const plan = yield* mutation.resolve({ path: parameters.workdir ?? ".", kind: "directory" })
            const external = plan.target.externalDirectory
            if (external) {
              yield* assertPermission({
                action: external.action,
                resources: [external.resource],
                save: [external.save],
              })
            }
            yield* assertPermission({ action: name, resources: [parameters.command], save: [parameters.command] })

            const target = yield* mutation.revalidate(plan)
            if (!target.exists || target.type !== "Directory") throw new Error(`Working directory is not a directory: ${target.canonical}`)

            const configs = yield* config.get()
            const shell = Object.assign({}, ...configs.map((item) => item.info)).shell ?? defaultShell()
            const command = ChildProcess.make(parameters.command, [], {
              cwd: target.canonical,
              shell,
              stdin: "ignore",
              detached: process.platform !== "win32",
              forceKillAfter: Duration.seconds(3),
            })
            const timeout = parameters.timeout ?? DEFAULT_TIMEOUT_MS
            const result = yield* appProcess.run(command, {
              timeout: Duration.millis(timeout),
              maxOutputBytes: MAX_CAPTURE_BYTES,
              maxErrorBytes: MAX_CAPTURE_BYTES,
            }).pipe(
              Effect.catchTag("AppProcessError", (error) =>
                isTimeout(error)
                  ? Effect.succeed(undefined)
                  : Effect.fail(error),
              ),
            )
            if (!result) {
              return {
                command: parameters.command,
                cwd: target.canonical,
                output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                truncated: false,
                timedOut: true,
              }
            }

            const compact = compactOutput(result.stdout.toString("utf8"), result.stderr.toString("utf8"))
            const notice = captureNotice(result.stdoutTruncated, result.stderrTruncated)
            const truncated = yield* resources.truncate({
              sessionID,
              toolCallID: call.id,
              content: notice ? `${compact}\n\n${notice}` : compact,
            })
            return {
              command: parameters.command,
              cwd: target.canonical,
              exitCode: result.exitCode,
              output: truncated.content,
              truncated: truncated.truncated || result.stdoutTruncated || result.stderrTruncated,
              ...(result.stdoutTruncated ? { stdoutTruncated: true } : {}),
              ...(result.stderrTruncated ? { stderrTruncated: true } : {}),
              ...(truncated.truncated ? { resource: truncated.resource } : {}),
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new ToolFailure({ message: `Unable to execute command: ${parameters.command}`, error: Cause.squash(cause) })),
            ),
          ),
      }),
    )
  }),
)
