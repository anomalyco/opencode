import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const root = path.join(import.meta.dir, "../..")

describe("run command", () => {
  test("authenticates in-process server requests when server password is set", async () => {
    await using dir = await tmpdir()
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "--conditions=browser",
        "./src/index.ts",
        "run",
        "--command",
        "definitely-not-a-command",
        "args",
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(dir.path, "share"),
        XDG_CACHE_HOME: path.join(dir.path, "cache"),
        XDG_CONFIG_HOME: path.join(dir.path, "config"),
        XDG_STATE_HOME: path.join(dir.path, "state"),
        OPENCODE_TEST_HOME: path.join(dir.path, "home"),
        OPENCODE_DB: ":memory:",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_DISABLE_PROJECT_CONFIG: "true",
        OPENCODE_SERVER_PASSWORD: "secret",
      },
    })

    const [, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const output = stdout + stderr

    // The invalid command may exit non-zero; reaching command resolution proves auth did not block session creation.
    expect(output).toContain('Command not found: "definitely-not-a-command"')
    expect(output).not.toContain("Session not found")
  }, 15_000)
})
