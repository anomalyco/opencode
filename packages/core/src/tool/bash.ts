export * as BashTool from "./bash"

import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { ShellJob } from "../shell-job"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const DEFAULT_BACKGROUND_TIMEOUT_MS = 24 * 60 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Input = Schema.Struct({
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
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the command as a managed background shell job. Use for dev servers, watchers, and long-running commands; use shell_status or shell_wait before declaring success.",
  }),
})

const Output = Schema.Struct({
  command: Schema.String,
  cwd: Schema.String,
  jobId: Schema.String.pipe(Schema.optional),
  status: Schema.Literals(["running", "exited", "timed_out", "cancelled", "failed"]).pipe(Schema.optional),
  startedAt: Schema.Number.pipe(Schema.optional),
  endedAt: Schema.Number.pipe(Schema.optional),
  durationMs: Schema.Number.pipe(Schema.optional),
  exitCode: Schema.Number.pipe(Schema.optional),
  /** Bounded compact equivalent of stdout/stderr: stderr is labeled when present. */
  output: Schema.String,
  truncated: Schema.Boolean,
  stdoutTruncated: Schema.Boolean.pipe(Schema.optional),
  stderrTruncated: Schema.Boolean.pipe(Schema.optional),
  timedOut: Schema.Boolean.pipe(Schema.optional),
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const JobInput = Schema.Struct({
  jobId: Schema.String,
})

const JobWaitInput = Schema.Struct({
  jobId: Schema.String,
  timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum time to wait in milliseconds. Omit to wait until the job reaches a final state.",
  }),
})

const JobLogsInput = Schema.Struct({
  jobId: Schema.String,
  lines: PositiveInt.pipe(Schema.optional).annotate({ description: "Number of recent log lines to return." }),
})

const JobOutput = Schema.Struct({
  jobId: Schema.String,
  status: Schema.Literals(["running", "exited", "timed_out", "cancelled", "failed"]),
  command: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.Number.pipe(Schema.optional),
  durationMs: Schema.Number,
  exitCode: Schema.Number.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
  timedOut: Schema.Boolean.pipe(Schema.optional),
  outputPreview: Schema.String,
  stdoutTruncated: Schema.Boolean.pipe(Schema.optional),
  stderrTruncated: Schema.Boolean.pipe(Schema.optional),
})

const LogsOutput = Schema.Struct({
  jobId: Schema.String,
  logs: Schema.String,
})

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

const compactOutput = (stdout: string, stderr: string) => {
  const output = stdout && stderr ? `${stdout}\n\nstderr:\n${stderr}` : stderr ? `stderr:\n${stderr}` : stdout
  return output || "(no output)"
}

const captureNotice = (stdoutTruncated: boolean, stderrTruncated: boolean) => {
  if (stdoutTruncated && stderrTruncated) return "[stdout and stderr capture truncated at the in-memory safety limit]"
  if (stdoutTruncated) return "[stdout capture truncated at the in-memory safety limit]"
  if (stderrTruncated) return "[stderr capture truncated at the in-memory safety limit]"
  return undefined
}

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.jobId)
    return [
      `Background shell job ${output.jobId}: ${output.status ?? "running"}.`,
      `Command: ${output.command}`,
      `cwd: ${output.cwd}`,
      output.exitCode === undefined ? undefined : `exitCode: ${output.exitCode}`,
      "",
      output.output,
      warnings,
      "",
      output.status === "running"
        ? "Use shell_status, shell_logs, shell_wait, or shell_cancel with this jobId. Do not use '&' as the primary background mechanism."
        : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n")
  if (output.timedOut) return `${output.output}${warnings}\n\nCommand timed out before completion.`
  return `${output.output}${warnings}\n\nCommand exited with code ${output.exitCode}.`
}

const jobModelOutput = (output: typeof JobOutput.Type) =>
  [
    `Shell job ${output.jobId}: ${output.status}`,
    `Command: ${output.command}`,
    `cwd: ${output.cwd}`,
    `durationMs: ${output.durationMs}`,
    output.exitCode === undefined ? undefined : `exitCode: ${output.exitCode}`,
    output.error === undefined ? undefined : `error: ${output.error}`,
    "",
    output.outputPreview,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

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
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const shellJob = yield* ShellJob.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; best-effort command-argument path warnings are advisory only. Timeout values are milliseconds (foreground default: ${DEFAULT_TIMEOUT_MS}; background default: ${DEFAULT_BACKGROUND_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows. Use background=true for dev servers, watchers, continuous commands, and long-running independent work; do not use '&' as the primary background mechanism. Call shell_status or shell_wait before declaring background command success.`,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: modelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const warnings = externalCommandDirectories(input.command, target.canonical).map(
                (directory) =>
                  `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
              )
              yield* permission.assert({
                action: name,
                resources: [input.command],
                save: [input.command],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              if ((yield* fs.stat(target.canonical)).type !== "Directory")
                return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

              const entries = yield* config.entries()
              const shell =
                Object.assign({}, ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])))
                  .shell ?? defaultShell()
              const command = ChildProcess.make(input.command, [], {
                cwd: target.canonical,
                shell,
                stdin: "ignore",
                detached: process.platform !== "win32",
                forceKillAfter: Duration.seconds(3),
              })
              const timeout = input.timeout ?? (input.background ? DEFAULT_BACKGROUND_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
              if (input.background) {
                const job = yield* shellJob.start({
                  sessionID: context.sessionID,
                  command: input.command,
                  cwd: target.canonical,
                  process: command,
                  timeout,
                })
                return {
                  command: input.command,
                  cwd: target.canonical,
                  jobId: job.jobId,
                  status: job.status,
                  startedAt: job.startedAt,
                  ...(job.endedAt ? { endedAt: job.endedAt } : {}),
                  durationMs: job.durationMs,
                  ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
                  ...(job.timedOut ? { timedOut: true } : {}),
                  output: job.outputPreview,
                  truncated: job.stdoutTruncated === true || job.stderrTruncated === true,
                  ...(warnings.length ? { warnings } : {}),
                  ...(job.stdoutTruncated ? { stdoutTruncated: true } : {}),
                  ...(job.stderrTruncated ? { stderrTruncated: true } : {}),
                }
              }
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
                  command: input.command,
                  cwd: target.canonical,
                  output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                  truncated: false,
                  timedOut: true,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const compact = compactOutput(result.stdout.toString("utf8"), result.stderr.toString("utf8"))
              const notice = captureNotice(result.stdoutTruncated, result.stderrTruncated)
              return {
                command: input.command,
                cwd: target.canonical,
                exitCode: result.exitCode,
                output: notice ? `${compact}\n\n${notice}` : compact,
                truncated: result.stdoutTruncated || result.stderrTruncated,
                ...(warnings.length ? { warnings } : {}),
                ...(result.stdoutTruncated ? { stdoutTruncated: true } : {}),
                ...(result.stderrTruncated ? { stderrTruncated: true } : {}),
              }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to execute command: ${input.command}` }))),
        }),
        shell_status: Tool.withPermission(
          Tool.make({
            description:
              "Return status and recent output for a managed background shell job created by bash background=true.",
            input: JobInput,
            output: JobOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: jobModelOutput(output) }],
            execute: (input, context) =>
              shellJob
                .status({ sessionID: context.sessionID, jobId: input.jobId })
                .pipe(
                  Effect.flatMap((job) =>
                    job
                      ? Effect.succeed(job)
                      : Effect.fail(new ToolFailure({ message: `Unknown shell job: ${input.jobId}` })),
                  ),
                ),
          }),
          name,
        ),
        shell_wait: Tool.withPermission(
          Tool.make({
            description:
              "Wait for a managed background shell job to finish, or return its current snapshot when the optional timeout elapses.",
            input: JobWaitInput,
            output: JobOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: jobModelOutput(output) }],
            execute: (input, context) =>
              shellJob
                .wait({ sessionID: context.sessionID, jobId: input.jobId, timeout: input.timeout })
                .pipe(
                  Effect.flatMap((job) =>
                    job
                      ? Effect.succeed(job)
                      : Effect.fail(new ToolFailure({ message: `Unknown shell job: ${input.jobId}` })),
                  ),
                ),
          }),
          name,
        ),
        shell_cancel: Tool.withPermission(
          Tool.make({
            description: "Cancel a managed background shell job and kill its process tree.",
            input: JobInput,
            output: JobOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: jobModelOutput(output) }],
            execute: (input, context) =>
              shellJob
                .cancel({ sessionID: context.sessionID, jobId: input.jobId })
                .pipe(
                  Effect.flatMap((job) =>
                    job
                      ? Effect.succeed(job)
                      : Effect.fail(new ToolFailure({ message: `Unknown shell job: ${input.jobId}` })),
                  ),
                ),
          }),
          name,
        ),
        shell_logs: Tool.withPermission(
          Tool.make({
            description: "Return recent logs for a managed background shell job.",
            input: JobLogsInput,
            output: LogsOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: output.logs }],
            execute: (input, context) =>
              shellJob
                .logs({ sessionID: context.sessionID, jobId: input.jobId, lines: input.lines })
                .pipe(
                  Effect.flatMap((logs) =>
                    logs === undefined
                      ? Effect.fail(new ToolFailure({ message: `Unknown shell job: ${input.jobId}` }))
                      : Effect.succeed({ jobId: input.jobId, logs }),
                  ),
                ),
          }),
          name,
        ),
      })
      .pipe(Effect.orDie)
  }),
)
