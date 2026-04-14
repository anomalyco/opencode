import path from "path"
import fs from "fs"
import os from "os"

export async function tmpdir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-team-test-"))
  return dir
}

export async function tmpdirWithGit(): Promise<string> {
  const dir = await tmpdir()
  const proc = Bun.spawn(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  await proc.exited
  const proc2 = Bun.spawn(["git", "config", "user.email", "test@test.com"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  await proc2.exited
  const proc3 = Bun.spawn(["git", "config", "user.name", "Test"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  await proc3.exited
  return dir
}

export async function cleanup(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true })
}
