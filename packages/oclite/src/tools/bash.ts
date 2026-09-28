import path from "path"
import { Effect, Exit, Schema } from "effect"
import type { RunToolContext } from "../contract"
import { killGroup } from "../hooks/hooks"
import { define } from "./fs"

// ---- permission patterns ----
// A shell metacharacter can chain or redirect, so such commands never match an allow glob like `git status*`.
// Also complex: a backslash anywhere, or a quote inside a word (`r''m`), since both can disguise a command name.
const COMPLEX = /[;&|><\n`()\\]|\$\(|\w['"]+\w/
const SEPARATORS = /\|\||&&|\$\(|[;&|\n`()]/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// Heads that run another command given as arguments; the wrapped command becomes a segment of its own.
const WRAPPERS = new Set(
  "bash sh zsh dash ksh fish eval exec xargs env command sudo doas nohup time timeout nice watch builtin source .".split(
    " ",
  ),
)

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
      const patterns = bashPatterns(params.command)
      return { permission: "bash", patterns, always: patterns[0] === "<complex>" ? [] : [prefix(patterns[0])] }
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

/**
 * Bash permission patterns: the command itself, or, when it chains, pipes, redirects, substitutes, wraps another
 * command (`bash -c`, `xargs`, `sudo`, …) or is obfuscated, `<complex>` plus each segment (naive split, subshell
 * bodies, wrapper heads stripped). Every pattern must be allowed and any deny wins, and `<complex>` never matches an
 * allow like `git status*`.
 *
 * This is a regex heuristic, not a shell parser, so it is not airtight: a deny glob layered under a broad allow or
 * bypassPermissions is best-effort. The real guard is the default `ask` for bash plus read_only's blanket deny.
 */
export function bashPatterns(command: string) {
  const trimmed = command.trim()
  const joined = trimmed.replace(/\\\n/g, "")
  const segments = joined
    .split(SEPARATORS)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const variants = segments.flatMap(unwrap)
  const complex = COMPLEX.test(trimmed) || variants.length > segments.length
  if (!complex) return [trimmed]
  return ["<complex>", ...new Set(variants)]
}

// A segment plus the forms a deny glob should see: head unquoted (`\rm` → `rm`) and wrapper heads stripped.
function unwrap(segment: string): string[] {
  const tokens = segment.split(/\s+/)
  const body = tokens.slice(
    Math.max(
      0,
      tokens.findIndex((token) => !ASSIGNMENT.test(token)),
    ),
  )
  const head = body[0].replace(/['"\\]/g, "")
  const plain = [head, ...body.slice(1)].join(" ")
  const forms = plain === segment ? [segment] : [segment, plain]
  if (!WRAPPERS.has(head)) return forms
  const rest = body.slice(1)
  const start = rest.findIndex((token) => !/^(-|\d+$)/.test(token) && !ASSIGNMENT.test(token))
  const inner =
    start === -1
      ? ""
      : rest
          .slice(start)
          .join(" ")
          .replace(/^['"]|['"]$/g, "")
          .trim()
  return [...forms, ...(inner ? unwrap(inner) : [])]
}
