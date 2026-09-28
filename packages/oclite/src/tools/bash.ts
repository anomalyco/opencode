import path from "path"
import { Effect, Exit, Schema } from "effect"
import type { RunToolContext } from "../contract"
import { killGroup } from "../hooks/hooks"
import { bashPattern } from "../permission/permission"
import { define } from "./fs"

export const DEFAULT_TIMEOUT_MS = 120_000
const SHELL = Bun.which("bash") ?? "/bin/sh"

// Same parameters as opencode's shell tool (tool/shell/prompt.ts parameterSchema).
const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The command to execute" }),
  timeout: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Optional timeout in milliseconds",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description:
      "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
  }),
})

export function bashTool(ctx: RunToolContext) {
  const workdir = (dir: string | undefined) => path.resolve(ctx.cwd, dir ?? ".")
  return define({
    name: "bash",
    parameters: Parameters,
    readOnly: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    // The registry's timeout interrupts `execute`, whose finalizer kills the whole process group.
    timeoutFor: (params) => params.timeout ?? DEFAULT_TIMEOUT_MS,
    access: (params) => {
      const pattern = bashPattern(params.command)
      return { permission: "bash", patterns: [pattern], always: pattern === "<complex>" ? [] : [prefix(pattern)] }
    },
    summarize: (params) => `bash ${params.command.split("\n")[0].slice(0, 80)}`,
    paths: (params) => [{ path: workdir(params.workdir), kind: "directory" }],
    execute: (params) =>
      Effect.acquireUseRelease(
        // Own process group (detached) so a timeout or cancel reaches every child, not just the shell.
        Effect.sync(() =>
          Bun.spawn([SHELL, "-c", `exec 2>&1\n${params.command}`], {
            cwd: workdir(params.workdir),
            env: { ...process.env },
            stdin: "ignore",
            stdout: "pipe",
            detached: true,
          }),
        ),
        (proc) =>
          Effect.promise(async () => {
            const [output, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
            const text = output.trimEnd() || "(no output)"
            return code === 0 ? text : `${text}\n\n(exit code ${code})`
          }),
        (proc, exit) => Effect.sync(() => (Exit.isSuccess(exit) ? undefined : killGroup(proc.pid))),
      ),
  })
}

// `always` for a simple command covers the same command and subcommand: `git status -s` → `git status *`.
function prefix(command: string) {
  const words = command.split(/\s+/)
  const head = words[1] && !words[1].startsWith("-") ? words.slice(0, 2) : words.slice(0, 1)
  return `${head.join(" ")} *`
}
