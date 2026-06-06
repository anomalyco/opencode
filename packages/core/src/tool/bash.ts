export * as BashTool from "./bash"

import path from "path"
import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PositiveInt } from "../schema"
import { ToolOutputStore } from "../tool-output-store"
import { ToolRegistry } from "./registry"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
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
  outputPath: Schema.String.pipe(Schema.optional),
  timedOut: Schema.Boolean.pipe(Schema.optional),
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Success = typeof Success.Type

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

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
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.timedOut) return `${output.output}${warnings}\n\nCommand timed out before completion.`
  return `${output.output}${warnings}\n\nCommand exited with code ${output.exitCode}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

const definition = Tool.make({
  description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; best-effort command-argument path warnings are advisory only. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
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
// TODO: Replace token-based command-argument external-directory advisories with parser-based detection.
// TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
// TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Persist background job status and define restart recovery before exposing remote observation.
// TODO: Re-add model-facing background launch only with owner-bound get/wait/cancel tools and completion delivery.
// TODO: Add HTTP background-job observation only after durable status, restart recovery, and authorization are defined.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

const shellTokens = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")
const externalCommandDirectories = (command: string, cwd: string) => {
  const directories = new Set<string>()
  for (const token of shellTokens(command)) {
    const value = unquote(token).replace(/[;,|&]+$/, "")
    if (!path.isAbsolute(value)) continue
    const resolved = FSUtil.resolve(value)
    if (FSUtil.contains(cwd, resolved)) continue
    directories.add(FSUtil.resolve(path.dirname(resolved)))
  }
  return [...directories]
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const resources = yield* ToolOutputStore.Service
    const config = yield* Config.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        outputPaths: (output) => (output.outputPath ? [output.outputPath] : []),
        execute: ({ parameters, sessionID, call, assertPermission }) =>
          Effect.gen(function* () {
            const target = yield* mutation.resolve({ path: parameters.workdir ?? ".", kind: "directory" })
            const external = target.externalDirectory
            if (external) yield* assertPermission(LocationMutation.externalDirectoryPermission(external))
            const warnings = externalCommandDirectories(parameters.command, target.canonical).map(
              (directory) =>
                `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
            )
            yield* assertPermission({ action: name, resources: [parameters.command], save: [parameters.command] })

            if ((yield* fs.stat(target.canonical)).type !== "Directory")
              throw new Error(`Working directory is not a directory: ${target.canonical}`)

            const entries = yield* config.entries()
            const shell =
              Object.assign({}, ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : []))).shell ??
              defaultShell()
            const command = ChildProcess.make(parameters.command, [], {
              cwd: target.canonical,
              shell,
              stdin: "ignore",
              detached: process.platform !== "win32",
              forceKillAfter: Duration.seconds(3),
            })
            const timeout = parameters.timeout ?? DEFAULT_TIMEOUT_MS
            const result = yield* appProcess
              .run(command, {
                timeout: Duration.millis(timeout),
                maxOutputBytes: MAX_CAPTURE_BYTES,
                maxErrorBytes: MAX_CAPTURE_BYTES,
              })
              .pipe(
                Effect.catchTag("AppProcessError", (error) =>
                  isTimeout(error) ? Effect.succeed(undefined) : Effect.fail(error),
                ),
              )
            if (!result) {
              return {
                command: parameters.command,
                cwd: target.canonical,
                output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                truncated: false,
                timedOut: true,
                ...(warnings.length ? { warnings } : {}),
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
              ...(warnings.length ? { warnings } : {}),
              ...(result.stdoutTruncated ? { stdoutTruncated: true } : {}),
              ...(result.stderrTruncated ? { stderrTruncated: true } : {}),
              ...(truncated.truncated && !result.stdoutTruncated && !result.stderrTruncated
                ? { outputPath: truncated.outputPath }
                : {}),
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ToolFailure({
                  message: `Unable to execute command: ${parameters.command}`,
                  error: Cause.squash(cause),
                }),
              ),
            ),
          ),
      }),
    )
  }),
)
