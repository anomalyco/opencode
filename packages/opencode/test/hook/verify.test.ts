import { describe, test, expect, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { verifyHookDeployment } from "../../src/hook/verify"
import type { HookConfig } from "../../src/hook/schema"

const tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-test-"))
  tmpDirs.push(dir)
  return dir
}

async function createScript(dir: string, name: string, mode: number): Promise<string> {
  const filePath = path.join(dir, name)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, "#!/bin/bash\nexit 0\n")
  await fs.chmod(filePath, mode)
  return filePath
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  tmpDirs.length = 0
})

describe("hook.verify", () => {
  test("detects orphan scripts", async () => {
    const hookDir = await makeTmpDir()
    await createScript(hookDir, "used.sh", 0o755)
    const extraPath = await createScript(hookDir, "extra.sh", 0o755)

    const config: HookConfig = {
      PreToolUse: [{ command: path.join(hookDir, "used.sh") }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    expect(result.orphanScripts).toContain(extraPath)
    expect(result.orphanScripts).not.toContain(path.join(hookDir, "used.sh"))
    expect(result.missingScripts).toEqual([])
    expect(result.permissionErrors).toEqual([])
  })

  test("detects missing scripts", async () => {
    const hookDir = await makeTmpDir()
    const missingPath = path.join(hookDir, "nonexistent.sh")

    const config: HookConfig = {
      PostToolUse: [{ command: missingPath }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    expect(result.missingScripts).toContain(missingPath)
  })

  test("detects permission errors for non-executable scripts", async () => {
    const hookDir = await makeTmpDir()
    const scriptPath = await createScript(hookDir, "readonly.sh", 0o644)

    const config: HookConfig = {
      SessionStart: [{ command: scriptPath }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    expect(result.permissionErrors).toContain(scriptPath)
    expect(result.missingScripts).toEqual([])
  })

  test("returns empty results for valid deployment", async () => {
    const hookDir = await makeTmpDir()
    const scriptPath = await createScript(hookDir, "valid.sh", 0o755)

    const config: HookConfig = {
      PreToolUse: [{ command: scriptPath }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    expect(result.orphanScripts).toEqual([])
    expect(result.missingScripts).toEqual([])
    expect(result.permissionErrors).toEqual([])
  })

  test("handles empty hook directory with undefined config", async () => {
    const hookDir = await makeTmpDir()

    const result = await verifyHookDeployment(hookDir, undefined)

    expect(result.orphanScripts).toEqual([])
    expect(result.missingScripts).toEqual([])
    expect(result.permissionErrors).toEqual([])
  })

  test("handles non-existent hook directory without throwing", async () => {
    const hookDir = path.join(os.tmpdir(), "hook-test-nonexistent-" + Date.now())
    const missingScript = "/tmp/does-not-exist/check.sh"

    const config: HookConfig = {
      Notification: [{ command: missingScript }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    expect(result.missingScripts).toContain(missingScript)
    expect(result.orphanScripts).toEqual([])
  })

  test("ignores inline shell commands without slash", async () => {
    const hookDir = await makeTmpDir()

    const config: HookConfig = {
      PreToolUse: [{ command: "echo hello" }],
      PostToolUse: [{ command: "cat /dev/null" }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    // "echo hello" has no slash in the first token, so it is not treated as a script path
    expect(result.missingScripts).toEqual([])
    expect(result.orphanScripts).toEqual([])
    expect(result.permissionErrors).toEqual([])
  })

  test("resolves relative paths against hookDir", async () => {
    const hookDir = await makeTmpDir()
    const scriptPath = await createScript(hookDir, "scripts/check.sh", 0o755)

    const config: HookConfig = {
      PreToolUse: [{ command: "scripts/check.sh --flag" }],
    }

    const result = await verifyHookDeployment(hookDir, config)

    // The script exists and is executable; relative path should resolve to hookDir/scripts/check.sh
    // Note: listScripts only reads top-level .sh files, so check.sh in a subdirectory
    // will not appear as an orphan. The referenced script should pass existence + permission checks.
    expect(result.missingScripts).toEqual([])
    expect(result.permissionErrors).toEqual([])
  })
})
