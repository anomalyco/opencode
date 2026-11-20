import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("login command", () => {
  test("is listed in top-level help", async () => {
    const result = await cli(["--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/login\s+Connect an integration \(alias for auth login\)/)
  })

  test("takes the same params and flags as auth login", async () => {
    const [login, auth] = await Promise.all([cli(["login", "--help"]), cli(["auth", "login", "--help"])])

    expect(login.exitCode).toBe(0)
    expect(auth.exitCode).toBe(0)
    expect(login.stdout).toContain("opencode login [flags] [<target>]")
    expect(sections(login.stdout)).toEqual(sections(auth.stdout))
    for (const flag of ["--method", "--answer", "--standalone", "--server"]) expect(login.stdout).toContain(flag)
  })

  test("runs the auth login handler", async () => {
    const [login, auth] = await Promise.all([cli(["login"]), cli(["auth", "login"])])

    expect(login.exitCode).toBe(1)
    expect(login.stdout + login.stderr).toContain("Pass an integration ID or name")
    expect(login.stdout + login.stderr).toBe(auth.stdout + auth.stderr)
  })
})

function sections(help: string) {
  return help.slice(help.indexOf("ARGUMENTS"))
}

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: process.env,
    stdin: "ignore",
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
