import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const cleanup: string[] = []

afterEach(() => {
  cleanup.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe("opencode db full CLI", () => {
  test("doctor stays read-only even with global flags before db", async () => {
    const dir = tempDir()
    const dbPath = join(dir, "missing.db")

    const result = await runCli(["--print-logs", "db", "doctor", "--json"], dbPath)

    expect(result.exitCode).toBe(2)
    expect(existsSync(dbPath)).toBe(false)
    expect(result.stdout).toContain('"code": "database_not_found"')
  })

  test("repair dry-run stays read-only even with global flags before db", async () => {
    const dir = tempDir()
    const dbPath = join(dir, "missing.db")

    const result = await runCli(["--print-logs", "db", "repair", "--dry-run", "--json"], dbPath)

    expect(result.exitCode).toBe(2)
    expect(existsSync(dbPath)).toBe(false)
    expect(result.stdout).toContain('"Database file does not exist"')
  })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-db-full-cli-"))
  cleanup.push(dir)
  return dir
}

async function runCli(args: string[], dbPath: string) {
  const proc = Bun.spawn(["bun", "run", "--conditions=browser", "./src/index.ts", ...args], {
    cwd: import.meta.dirname.replace(/\\test\\db$/, ""),
    env: {
      ...process.env,
      OPENCODE_DB: dbPath,
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, exitCode }
}
