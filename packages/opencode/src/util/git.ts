import { Process } from "./process"

/**
 * Represents the result of executing a git command.
 *
 * Provides access to the command's exit code, standard output,
 * standard error, and a convenience method to get output as text.
 */
export interface GitResult {
  /** The exit code of the git command (0 typically indicates success) */
  exitCode: number
  /**
   * Returns the stdout content as a string.
   * @returns The standard output converted to string
   */
  text(): string
  /** The raw standard output buffer */
  stdout: Buffer
  /** The raw standard error buffer */
  stderr: Buffer
}

/**
 * Executes a git command in the specified working directory.
 *
 * This function runs git commands with proper error handling and output capture.
 * Uses stdin ignore to prevent protocol pipe inheritance issues in embedded
 * environments. Returns a structured result with exit code and output buffers.
 *
 * @param args - Array of git command arguments (e.g., ["status", "--porcelain"])
 * @param opts - Options for command execution
 * @param opts.cwd - The working directory where git should run
 * @param opts.env - Optional environment variables to set
 * @returns A promise resolving to the command result
 * @example
 * ```typescript
 * const result = await git(["status", "--porcelain"], { cwd: "/path/to/repo" })
 * if (result.exitCode === 0) {
 *   console.log(result.text())
 * }
 * ```
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
