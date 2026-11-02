export * as ShellTool from "./shell.js"

import { SystemPart, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Schema, Scope } from "effect"
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
import { Sandbox } from "../../sandbox.js"
import { SandboxDiagnostics } from "../../sandbox/diagnostics.js"
import { SandboxApproval } from "../../sandbox/approval.js"

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
const description = (shell?: string, sandbox = false, fullDiskRead = false) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    "Commands accept an optional timeout, background commands have no timeout by default.",
    "Background commands return immediately, and you will be notified when they complete.",
    ...(sandbox
      ? [
          "Commands run in an OS sandbox: only the workspace and configured roots are writable, and network access is blocked.",
          fullDiskRead
            ? "Filesystem reads are allowed across the disk except for protected credentials and OpenCode state."
            : "Filesystem reads are restricted to the workspace, system runtime, and configured readable roots.",
          "Built-in read, write, edit, patch, glob, and grep also use this filesystem policy. Other host integrations have separate permissions.",
          "If a command is blocked, inspect its output and request a new invocation with sandbox_permissions=require_escalated and a justification when necessary. It may have partially completed; do not blindly retry.",
        ]
      : []),
  ].join(" ")

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  sandbox_permissions: Schema.optionalKey(Schema.Literals(["use_default", "require_escalated"])).annotate({
    description:
      "Use the server's sandbox by default. Request require_escalated to ask the user to run this single command outside it.",
  }),
  justification: Schema.optionalKey(Schema.String).annotate({
    description: "Required when requesting escalation: explain why this command needs to run outside the sandbox.",
  }),
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

const StockInput = Schema.Struct({
  command: Input.fields.command,
  workdir: Input.fields.workdir,
  timeout: Input.fields.timeout,
  background: Input.fields.background,
})

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
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
    const sandbox = yield* Sandbox.Service

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const source = {
        type: "tool" as const,
        messageID: context.messageID,
        id: context.id,
      }
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
      if (!sandbox.enabled) yield* access.authorizeExternal([target, ...directories], context)
      if (sandbox.enabled) {
        const resources = [target, ...directories].flatMap((item) =>
          item.externalDirectory ? [item.externalDirectory.resource] : [],
        )
        if (resources.length > 0)
          yield* permission.assert({
            action: "external_directory",
            resources,
            sessionID: context.sessionID,
            agent: context.agent,
            source,
            prompt: "skip",
          })
      }
      if (parsed.commands.length > 0 || sandbox.enabled)
        yield* permission.assert({
          action: name,
          resources:
            parsed.commands.length > 0 ? parsed.commands.map((command) => command.resource) : [invocation.command],
          save: parsed.commands.map((command) => command.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
          prompt: sandbox.enabled ? "skip" : undefined,
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

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(undefined, sandbox.enabled, sandbox.fullDiskRead),
          input: sandbox.enabled ? Input : StockInput,
          output: Output,
          execute: (input: typeof Input.Type, context) =>
            Effect.gen(function* () {
              const escalated = input.sandbox_permissions === "require_escalated"
              if (escalated && (!sandbox.enabled || sandbox.approval === "never"))
                return yield* new Sandbox.UnavailableError({
                  message: "Sandbox escalation is not enabled on this server.",
                })
              if (escalated && !input.justification?.trim())
                return yield* Effect.fail(new Error("A non-empty justification is required for sandbox escalation."))
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
                    finalTimeout = yield* prepare(invocation, context)
                    if (!sandbox.enabled) return
                    if (escalated)
                      yield* permission.assert({
                        action: "sandbox.exec",
                        resources: [invocation.command],
                        sessionID: context.sessionID,
                        agent: context.agent,
                        source: { type: "tool", messageID: context.messageID, id: context.id },
                        metadata: {
                          command: invocation.command,
                          cwd: invocation.cwd,
                          justification: input.justification,
                          sandbox: "disabled",
                        },
                        prompt: "force",
                        sandboxCommand: yield* SandboxApproval.analyze(invocation),
                      })
                    return yield* sandbox.prepare(invocation, escalated)
                  }),
              )
              yield* context.progress({ shellID: info.id })

              const settled = yield* Deferred.make<Output>()
              const run = Effect.gen(function* () {
                const result = yield* shell.result(info)
                if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                const output = ShellResult.output(result)
                const hint =
                  sandbox.enabled &&
                  !escalated &&
                  !output.timeout &&
                  result.info.status !== "killed" &&
                  (output.exit !== 0 || output.signal !== undefined)
                    ? SandboxDiagnostics.hint(output.output)
                    : undefined
                return {
                  ...output,
                  output: output.timeout
                    ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`
                    : hint
                      ? `${output.output}\n\n${hint}`
                      : output.output,
                  status: "completed" as const,
                }
              }).pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => resultMessages(output).join("\n\n")),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
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

              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                return backgroundResult(info.id, info.file)
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

              return yield* Deferred.await(settled)
            }).pipe(
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
        tool.description = description(ShellSelect.name(yield* compatibleShell), sandbox.enabled, sandbox.fullDiskRead)
        if (sandbox.enabled)
          event.system.push(
            SystemPart.make(
              "Shell execution policy: the shell tool runs commands in an OS sandbox with restricted filesystem access and no network. " +
                (sandbox.fullDiskRead
                  ? "Disk reads are broadly allowed except for protected credentials and OpenCode state; writes remain limited to the workspace, scratch, and configured writable roots. "
                  : "Reads are limited to the workspace, system runtime, and configured readable roots. ") +
                "This policy takes precedence over generic environment descriptions. Scheduled shell checks, built-in file tools, searches, image file access and automatic formatters share this filesystem boundary; host integrations, web and MCP tools remain separate. Native file tools and automatic formatters cannot escalate; use an explicitly approved shell invocation when necessary. Worktree mutations and the shipped browser plugin are unavailable while sandboxed; Git snapshots are disabled. " +
                (sandbox.approval === "never"
                  ? "Escalation is disabled; continue within the sandbox."
                  : "To run a command outside the sandbox, set sandbox_permissions=require_escalated and supply a justification. The user can approve one invocation or a suggested literal command prefix for this session; never assume a grant exists."),
            ),
          )
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
