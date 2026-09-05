import { execFile } from "child_process"
import { promisify } from "util"

const exec = promisify(execFile)

export interface GitClient {
  clone(repo: string, dir: string, token?: string): Promise<void>
  fetch(dir: string, remote?: string): Promise<void>
  checkout(dir: string, branch: string): Promise<void>
  createBranch(dir: string, branch: string, base?: string): Promise<void>
  commitAll(dir: string, message: string): Promise<void>
  push(dir: string, branch: string, remote?: string): Promise<void>
  getRemoteUrl(dir: string, remote?: string): Promise<string>
  getRev(dir: string): Promise<string>
  hasChanges(dir: string): Promise<boolean>
}

async function run(dir: string, command: string, args: string[]): Promise<string> {
  const { stdout } = await exec(command, args, { cwd: dir, timeout: 60_000 })
  return stdout.trim()
}

export function createGitClient(): GitClient {
  return {
    async clone(repo, dir, token) {
      const url = token
        ? `https://x-access-token:${token}@github.com/${repo}.git`
        : `https://github.com/${repo}.git`
      await run(dir, "git", ["clone", url, "."])
    },

    async fetch(dir, remote = "origin") {
      await run(dir, "git", ["fetch", remote])
    },

    async checkout(dir, branch) {
      await run(dir, "git", ["checkout", branch])
    },

    async createBranch(dir, branch, base = "HEAD") {
      await run(dir, "git", ["checkout", "-b", branch, base])
    },

    async commitAll(dir, message) {
      await run(dir, "git", ["add", "-A"])
      await run(dir, "git", [
        "-c", "user.name=TeamJules",
        "-c", "user.email=teamjules@opencode.local",
        "commit",
        "-m", message,
        "--allow-empty",
      ])
    },

    async push(dir, branch, remote = "origin") {
      await run(dir, "git", ["push", "-u", remote, branch])
    },

    async getRemoteUrl(dir, remote = "origin") {
      return run(dir, "git", ["remote", "get-url", remote])
    },

    async getRev(dir) {
      return run(dir, "git", ["rev-parse", "HEAD"])
    },

    async hasChanges(dir) {
      const output = await run(dir, "git", ["status", "--porcelain"])
      return output.length > 0
    },
  }
}
