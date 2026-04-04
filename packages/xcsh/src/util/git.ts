import { Process } from "./process"

export interface GitResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

/**
 * Run a git command.
 *
 * Uses Process helpers with stdin ignored to avoid protocol pipe inheritance
 * issues in embedded/client environments.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  return Process.run(["git", ...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdin: "ignore",
    nothrow: true,
  })
    .then((result) => ({
      exitCode: result.code,
      text: () => result.stdout.toString(),
      stdout: result.stdout,
      stderr: result.stderr,
    }))
    .catch((error) => ({
      exitCode: 1,
      text: () => "",
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
    }))
}
