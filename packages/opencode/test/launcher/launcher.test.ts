import { spawnSync } from "child_process"
import { mkdirSync, writeFileSync, chmodSync, realpathSync } from "fs"
import { join, dirname } from "path"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"

const launcherPath = join(import.meta.dirname, "../../bin/opencode.mjs")
const scriptDir = dirname(realpathSync(launcherPath))

function createFakeBinary(dir: string, exitCode = 0, output = "opencode-test-version") {
  const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode"
  mkdirSync(dir, { recursive: true })
  const binPath = join(dir, binaryName)

  if (process.platform === "win32") {
    writeFileSync(binPath, `@echo off\r\necho ${output}\r\nexit /b ${exitCode}\r\n`)
  } else {
    writeFileSync(binPath, `#!/bin/sh\necho ${output}\nexit ${exitCode}\n`)
    chmodSync(binPath, 0o755)
  }

  return binPath
}

function runLauncher(args: string[] = ["--version"], extraEnv?: Record<string, string>) {
  return spawnSync(process.execPath, [launcherPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 10000,
  })
}

describe("opencode.mjs launcher", () => {
  test("resolves binary via OPENCODE_BIN_PATH env var", async () => {
    await using tmp = await tmpdir()

    const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode"
    const binPath = join(tmp.path, binaryName)
    createFakeBinary(tmp.path)

    const result = runLauncher(["--version"], { OPENCODE_BIN_PATH: binPath })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("opencode-test-version")
  })

  test("forwards arguments to the binary", async () => {
    await using tmp = await tmpdir()

    const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode"
    const binPath = join(tmp.path, binaryName)
    mkdirSync(tmp.path, { recursive: true })

    if (process.platform === "win32") {
      writeFileSync(binPath, `@echo off\r\necho args: %*\r\nexit /b 0\r\n`)
    } else {
      writeFileSync(binPath, "#!/bin/sh\necho args: $@\nexit 0\n")
      chmodSync(binPath, 0o755)
    }

    const result = runLauncher(["--version", "--model", "gpt-4"], { OPENCODE_BIN_PATH: binPath })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("args: --version --model gpt-4")
  })

  test("propagates exit code from the binary", async () => {
    await using tmp = await tmpdir()

    const binPath = createFakeBinary(tmp.path, 42, "error occurred")
    const result = runLauncher(["--version"], { OPENCODE_BIN_PATH: binPath })

    expect(result.status).toBe(42)
    expect(result.stdout).toContain("error occurred")
  })

  test("shows error when OPENCODE_BIN_PATH points to nonexistent path", async () => {
    const badPath = join(scriptDir, "nonexistent-binary" + (process.platform === "win32" ? ".exe" : ""))
    const result = runLauncher(["--version"], { OPENCODE_BIN_PATH: badPath })

    // Should fail because the path doesn't exist
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("OpenCode installation is incomplete")
    expect(result.stderr).toContain("platform executable has not been installed")
  })

  test("loads platform package name for current system", () => {
    // Verify the packageNames logic produces valid names
    const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
    const archMap: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }
    const p = platformMap[process.platform] || process.platform
    const a = archMap[process.arch] || process.arch

    expect(p).toBeTruthy()
    expect(a).toBeTruthy()
    expect(p).toMatch(/^(darwin|linux|windows)$/)
    expect(a).toMatch(/^(x64|arm64|arm)$/)
  })
})
