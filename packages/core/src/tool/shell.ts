export * as ShellTool from "./shell"

import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { Effect, Schema, Scope } from "effect"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { PluginRuntime } from "../plugin/runtime"
import { PositiveInt } from "../schema"
import { SessionSchema } from "../session/schema"
import { Shell } from "../shell"
import { Tool, type Content } from "./tool"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

const BACKGROUND_STARTED =
  "The command has not completed; it is now running in the background."

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
  background: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Run the command in the background and return immediately. You will be notified when it completes. DO NOT poll its progress.",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  shellID: Schema.String.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.Literals(["completed", "running"]).pipe(Schema.optional),
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const modelOutput = (output: Output): string | undefined => {
  if (output.status === "running") return undefined
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

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
// TODO: Persist job status and define restart recovery before exposing remote observation.
// TODO: Add HTTP job observation only after durable status, restart recovery, and authorization are defined.
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

export const Plugin = {
  id: "core-shell-tool",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: PluginContext) {
    const runtime = yield* PluginRuntime.Service
    const scope = yield* Scope.Scope
    const fsUtil = yield* FSUtil.Service
    const mutation = yield* LocationMutation.Service
    const shell = yield* Shell.Service
    const permission = yield* PermissionV2.Service

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(function* (
      sessionID: SessionSchema.ID,
      callID: string,
      command: string,
    ) {
      yield* runtime.job.wait({ id: callID }).pipe(
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
            text: `<shell id="${callID}" state="${state}" command="${command}">\n${text}\n</shell>`,
          })
        }),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    yield* ctx.tool
      .register({
        [name]: Tool.make({
          description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; best-effort command-argument path warnings are advisory only. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows. Background mode (background=true) launches the command asynchronously and returns immediately; you are notified when it finishes.`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => ({
            truncated: output.truncated,
            ...(output.exit === undefined ? {} : { exit: output.exit }),
            ...(output.shellID === undefined ? {} : { shellID: output.shellID }),
            ...(output.timeout === undefined ? {} : { timeout: output.timeout }),
          }),
          toModelOutput: ({ output }) => {
            const parts: Content[] = [{ type: "text", text: output.output }]
            const model = modelOutput(output)
            if (model) parts.push({ type: "text", text: model })
            return parts
          },
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
                  `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Shell runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
              )
              yield* permission.assert({
                action: name,
                resources: [input.command],
                save: [input.command],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              if ((yield* fsUtil.stat(target.canonical)).type !== "Directory")
                return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

              const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
              const info = yield* shell.create({
                command: input.command,
                cwd: target.canonical,
                timeout,
                metadata: { sessionID: context.sessionID },
              })

              const settleShell = Effect.fn("ShellTool.settleShell")(function* () {
                const final = yield* shell.wait(info.id)
                const page = yield* shell.output(info.id, { limit: MAX_CAPTURE_BYTES })

                if (final.status === "timeout") {
                  return {
                    exit: final.exit,
                    output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                    truncated: false,
                    timeout: true,
                    status: "completed" as const,
                  }
                }

                const truncated = page.size > page.cursor
                const body = page.output || "(no output)"
                const notice = truncated ? `\n\n[output truncated; full output saved to: ${final.file}]` : ""
                return {
                  exit: final.exit,
                  output: `${body}${notice}`,
                  truncated,
                  status: "completed" as const,
                }
              })

              const run = settleShell().pipe(
                Effect.map((output) => output.output),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* runtime.job.start({
                id: context.toolCallID,
                type: name,
                title: input.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                run,
              })

              if (input.background === true) {
                yield* runtime.job.background(job.id)
                yield* notifyWhenDone(context.sessionID, context.toolCallID, input.command)
                return {
                  output: BACKGROUND_STARTED,
                  shellID: info.id,
                  truncated: false,
                  status: "running" as const,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const result = yield* runtime.job.block({ id: job.id, sessionID: context.sessionID }).pipe(
                Effect.onInterrupt(() => runtime.job.cancel(job.id).pipe(Effect.ignore)),
              )
              if (result?.type === "backgrounded") {
                yield* notifyWhenDone(context.sessionID, context.toolCallID, input.command)
                return {
                  output: BACKGROUND_STARTED,
                  shellID: info.id,
                  truncated: false,
                  status: "running" as const,
                  ...(warnings.length ? { warnings } : {}),
                }
              }
              if (result?.info.status === "error") return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

              return {
                ...(yield* settleShell()),
                ...(warnings.length ? { warnings } : {}),
              }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to execute command: ${input.command}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
}
