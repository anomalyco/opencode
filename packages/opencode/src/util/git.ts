import { $ } from "bun"
import { buffer } from "node:stream/consumers"
import { Flag } from "../flag/flag"
import { Process } from "./process"

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
 * case we fall back to `Process.spawn` with `stdin: "ignore"`.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  if (Flag.OPENCODE_CLIENT === "acp") {
    try {
      const proc = Process.spawn(["git", ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      })
      // Read output concurrently with exit to avoid pipe buffer deadlock
      if (!proc.stdout || !proc.stderr) {
        throw new Error("Process output not available")
      }
      const [exitCode, out, err] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
      return {
        exitCode,
        text: () => out.toString(),
        stdout: out,
        stderr: err,
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
