import { expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import childProcess from "node:child_process"

test("launcher finds native binary via require.resolve and directory traversal", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-launcher-test-"))
  try {
    const pkgDir = path.join(temp, "node_modules", "@opencode", "cli")
    const binDir = path.join(pkgDir, "bin")
    const nativeDir = path.join(temp, "node_modules", "@opencode", "cli-linux-x64", "bin")
    fs.mkdirSync(binDir, { recursive: true })
    fs.mkdirSync(nativeDir, { recursive: true })
    const dummyBinary = path.join(nativeDir, "opencode")
    fs.writeFileSync(dummyBinary, "#!/bin/sh\necho opencode-native-ok\n")
    fs.chmodSync(dummyBinary, 0o755)

    fs.writeFileSync(
      path.join(temp, "node_modules", "@opencode", "cli-linux-x64", "package.json"),
      JSON.stringify({ name: "@opencode/cli-linux-x64", version: "2.0.3" }),
    )

    // Copy opencode.cjs into test binDir
    const launcherScript = path.join(binDir, "opencode.cjs")
    fs.copyFileSync(
      path.resolve(__dirname, "../bin/opencode.cjs"),
      launcherScript,
    )
    fs.chmodSync(launcherScript, 0o755)

    // Run the launcher script with node
    const result = childProcess.spawnSync("node", [launcherScript], {
      cwd: temp,
      encoding: "utf8",
    })

    expect(result.stdout.trim()).toBe("opencode-native-ok")
    expect(result.status).toBe(0)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test("legacy alias opencode2.cjs forwards to opencode.cjs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-launcher-alias-"))
  try {
    const pkgDir = path.join(temp, "node_modules", "@opencode", "cli")
    const binDir = path.join(pkgDir, "bin")
    const nativeDir = path.join(temp, "node_modules", "@opencode", "cli-linux-x64", "bin")
    fs.mkdirSync(binDir, { recursive: true })
    fs.mkdirSync(nativeDir, { recursive: true })
    const dummyBinary = path.join(nativeDir, "opencode")
    fs.writeFileSync(dummyBinary, "#!/bin/sh\necho opencode2-native-ok: \"$@\"\n")
    fs.chmodSync(dummyBinary, 0o755)

    fs.writeFileSync(
      path.join(temp, "node_modules", "@opencode", "cli-linux-x64", "package.json"),
      JSON.stringify({ name: "@opencode/cli-linux-x64", version: "2.0.3" }),
    )

    fs.copyFileSync(
      path.resolve(__dirname, "../bin/opencode.cjs"),
      path.join(binDir, "opencode.cjs"),
    )
    fs.chmodSync(path.join(binDir, "opencode.cjs"), 0o755)

    const aliasScript = path.join(binDir, "opencode2.cjs")
    fs.writeFileSync(aliasScript, `#!/usr/bin/env node\n\nrequire("./opencode.cjs")\n`)
    fs.chmodSync(aliasScript, 0o755)

    const result = childProcess.spawnSync("node", [aliasScript, "--test-flag", "value"], {
      cwd: temp,
      encoding: "utf8",
    })

    expect(result.stdout.trim()).toBe("opencode2-native-ok: --test-flag value")
    expect(result.status).toBe(0)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test("launcher uses pre-cached binary when available", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-launcher-cached-"))
  try {
    const binDir = path.join(temp, "bin")
    fs.mkdirSync(binDir, { recursive: true })

    const cachedBinary = path.join(binDir, ".opencode")
    fs.writeFileSync(cachedBinary, "#!/bin/sh\necho cached-ok\n")
    fs.chmodSync(cachedBinary, 0o755)

    const launcherScript = path.join(binDir, "opencode.cjs")
    fs.copyFileSync(
      path.resolve(__dirname, "../bin/opencode.cjs"),
      launcherScript,
    )
    fs.chmodSync(launcherScript, 0o755)

    const result = childProcess.spawnSync("node", [launcherScript], {
      cwd: temp,
      encoding: "utf8",
    })

    expect(result.stdout.trim()).toBe("cached-ok")
    expect(result.status).toBe(0)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test("launcher reports clear error when native package is missing", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-launcher-missing-"))
  try {
    const binDir = path.join(temp, "bin")
    fs.mkdirSync(binDir, { recursive: true })

    const launcherScript = path.join(binDir, "opencode.cjs")
    fs.copyFileSync(
      path.resolve(__dirname, "../bin/opencode.cjs"),
      launcherScript,
    )
    fs.chmodSync(launcherScript, 0o755)

    const result = childProcess.spawnSync("node", [launcherScript], {
      cwd: temp,
      encoding: "utf8",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("It seems that your package manager failed to install the right opencode CLI package")
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
