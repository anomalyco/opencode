import { $ } from "bun"
import { Flag } from "../flag/flag"

export interface GitResult {
  exitCode: number
  text(): string | Promise<string>
  stdout: Buffer | ReadableStream<Uint8Array>
  stderr: Buffer | ReadableStream<Uint8Array>
}

/**
 * Run a git command.
 *
 * Uses Bun's lightweight `$` shell by default.  When the process is running
 * as an ACP client, child processes inherit the parent's stdin pipe which
 * carries protocol data – on Windows this causes git to deadlock.  In that
 * case we fall back to `Bun.spawn` with `stdin: "ignore"`.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  if (Flag.OPENCODE_CLIENT === "acp") {
    try {
      const proc = Bun.spawn(["git", ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      })
      // Read output concurrently with exit to avoid pipe buffer deadlock
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
      ])
      const stdoutBuf = Buffer.from(stdout)
      const stderrBuf = Buffer.from(stderr)
      return {
        exitCode,
        text: () => stdoutBuf.toString(),
        stdout: stdoutBuf,
        stderr: stderrBuf,
      }
    } catch (error) {
      const stderr = Buffer.from(error instanceof Error ? error.message : String(error))
      return {
        exitCode: 1,
        text: () => "",
        stdout: Buffer.alloc(0),
        stderr,
      }
    }
  }

  const env = opts.env ? { ...process.env, ...opts.env } : undefined
  let cmd = $`git ${args}`.quiet().nothrow().cwd(opts.cwd)
  if (env) cmd = cmd.env(env)
  const result = await cmd
  return {
    exitCode: result.exitCode,
    text: () => result.text(),
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
