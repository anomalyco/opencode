import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

describe("default command directory", () => {
  test("shows help instead of ENOENT for a missing directory", async () => {
    const result = await cli(["login"])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("opencode <subcommand> [flags] [<directory>]")
    expect(result.stdout + result.stderr).toContain('No directory or command named "login"')
    expect(result.stdout + result.stderr).not.toContain("ENOENT")
  })

  test("shows help for a path that is a file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-default-directory-"))
    const file = path.join(root, "file.txt")
    await fs.writeFile(file, "")

    try {
      const result = await cli([file])

      expect(result.exitCode).toBe(1)
      expect(result.stdout + result.stderr).toContain(`No directory or command named "${file}"`)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
