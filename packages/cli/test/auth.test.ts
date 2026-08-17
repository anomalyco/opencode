import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("auth command", () => {
  test("registers login", async () => {
    const [auth, login] = await Promise.all([cli(["auth", "--help"]), cli(["auth", "login", "--help"])])

    expect(auth.exitCode).toBe(0)
    expect(auth.stdout).toContain("login")
    expect(auth.stdout).toContain("Log in to a well-known authentication provider")
    expect(auth.stdout).not.toContain("connect")
    expect(login.exitCode).toBe(0)
    expect(login.stdout).toContain("opencode auth login [flags] <url>")
    expect(login.stdout).toContain("Well-known provider URL")
  })
})

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
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
