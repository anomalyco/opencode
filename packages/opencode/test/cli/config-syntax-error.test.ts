import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"

// Invalid JSON config - missing comma after "type": "local"
const INVALID_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "example": {
      "type": "local"
      "command": ["echo", "hello"]
    }
  }
}`

// Package root directory for proper module resolution
const PACKAGE_DIR = path.join(import.meta.dir, "../..")
const ENTRY_POINT = path.join(PACKAGE_DIR, "src/index.ts")

describe("CLI startup with invalid config", () => {
  test("TUI should exit with error instead of hanging on invalid JSON syntax", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), INVALID_CONFIG)
      },
    })

    // Pass the project path as argument - TUI command accepts [project] positional
    const proc = Bun.spawn({
      cmd: ["bun", "run", "--conditions=browser", ENTRY_POINT, tmp.path],
      cwd: PACKAGE_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CI: "true",
      },
    })

    const TIMEOUT_MS = 5000
    const timeoutId = setTimeout(() => proc.kill(), TIMEOUT_MS)

    const exitCode = await proc.exited
    clearTimeout(timeoutId)

    // If process was killed by timeout (exitCode is signal-based), it hung
    // On SIGTERM, exit code is typically 143 (128 + 15) or null
    const wasKilled = exitCode === null || exitCode >= 128
    expect(wasKilled).toBe(false)

    expect(exitCode).not.toBe(0)

    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toContain("not valid JSON")
  })
})
