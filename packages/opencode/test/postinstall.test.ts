import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, linkSync, renameSync, copyFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir, platform, arch } from "os"
import { spawnSync } from "child_process"

const binShim = readFileSync(join(import.meta.dir, "..", "script", "bin-shim.js"), "utf8")
const postinstall = readFileSync(join(import.meta.dir, "..", "script", "postinstall.mjs"), "utf8")

const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
const archMap: Record<string, string> = { x64: "x64", arm64: "arm64" }
const plat = platformMap[platform()] ?? platform()
const parch = archMap[arch()] ?? arch()
const currentName = `opencode-${plat}-${parch}`
const isWindows = platform() === "win32"
const binaryName = isWindows ? "opencode.exe" : "opencode"

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "opencode-postinstall-test-"))
  const binDir = join(dir, "bin")
  mkdirSync(binDir, { recursive: true })
  return { dir, binDir, binPath: join(binDir, binaryName) }
}

function writeWrapper(t: ReturnType<typeof tmp>) {
  writeFileSync(t.binPath, binShim)
  chmodSync(t.binPath, 0o755)
}

function setupPlatformPackage(t: ReturnType<typeof tmp>, name = currentName, bin = binaryName) {
  const pkgDir = join(t.dir, "node_modules", name)
  mkdirSync(join(pkgDir, "bin"), { recursive: true })
  writeFileSync(join(pkgDir, "bin", bin), "#!/bin/sh\necho \"test-binary $0\"\n")
  chmodSync(join(pkgDir, "bin", bin), 0o755)
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name }))
  return join(pkgDir, "bin", bin)
}

function cleanup(t: ReturnType<typeof tmp>) {
  try { rmSync(t.dir, { recursive: true, force: true }) } catch {}
}

describe("esbuild-style wrapper (bin-shim.js)", () => {
  test(`resolves ${currentName} binary on ${platform()}`, () => {
    const t = tmp()
    setupPlatformPackage(t)
    writeWrapper(t)

    const { status, stdout } = spawnSync(process.execPath, [t.binPath, "--version"], {
      cwd: t.dir, encoding: "utf8",
    })
    expect(status).toBe(0)
    expect(stdout.trim()).toMatch(/test-binary /)
    cleanup(t)
  })

  test("maps all platforms in platformMap", () => {
    expect(binShim).toContain('darwin: "darwin"')
    expect(binShim).toContain('linux: "linux"')
    expect(binShim).toContain('win32: "windows"')
  })

  test("maps both arches in archMap", () => {
    expect(binShim).toContain('x64: "x64"')
    expect(binShim).toContain('arm64: "arm64"')
  })

  test("uses opencode.exe binary name on windows, opencode elsewhere", () => {
    expect(binShim).toContain('platform === "windows" ? "opencode.exe" : "opencode"')
  })

  test("falls back to __dirname binary when platform package missing", () => {
    expect(binShim).toContain("path.join(__dirname, binary)")
  })
})

describe("postinstall platform handling (postinstall.mjs)", () => {
  test(`uses "${binaryName}" as binaryName on ${platform()}`, () => {
    expect(postinstall).toContain(`"opencode.exe" : "opencode"`)
  })

  test.skipIf(!isWindows)("copies binary as opencode.exe alongside JS wrapper", () => {
    const t = tmp()
    const src = setupPlatformPackage(t)
    writeWrapper(t)

    copyFileSync(src, t.binPath)
    chmodSync(t.binPath, 0o755)

    expect(existsSync(t.binPath)).toBe(true)
    expect(readFileSync(t.binPath, "utf8").startsWith("#!/bin/sh")).toBe(true)
    cleanup(t)
  })

  test.skipIf(isWindows)("atomically replaces wrapper via link to bin-opencode then rename", () => {
    const t = tmp()
    const src = setupPlatformPackage(t)
    writeWrapper(t)

    const before = readFileSync(t.binPath, "utf8")
    expect(before.startsWith("#!/usr/bin/env node")).toBe(true)

    const temp = join(t.dir, "bin-opencode")
    linkSync(src, temp)
    renameSync(temp, t.binPath)
    chmodSync(t.binPath, 0o755)

    const after = readFileSync(t.binPath, "utf8")
    expect(after.split("\n")[0]).toBe("#!/bin/sh")

    const { status, stdout } = spawnSync(t.binPath, ["--version"], {
      cwd: t.dir, encoding: "utf8",
    })
    expect(status).toBe(0)
    expect(stdout.trim()).toMatch(/test-binary /)
    cleanup(t)
  })

  test.skipIf(isWindows)("replacement has no ENOENT window", () => {
    const t = tmp()
    const src = setupPlatformPackage(t)
    writeWrapper(t)

    const temp = join(t.dir, "bin-opencode")
    linkSync(src, temp)
    expect(existsSync(t.binPath)).toBe(true)
    renameSync(temp, t.binPath)
    expect(existsSync(t.binPath)).toBe(true)
    cleanup(t)
  })

  test("postinstall.mjs uses bin-opencode temp path", () => {
    expect(postinstall).toContain('"bin-opencode"')
  })

  test("maps all platforms in postinstall.mjs", () => {
    expect(postinstall).toContain('darwin: "darwin"')
    expect(postinstall).toContain('linux: "linux"')
    expect(postinstall).toContain('win32: "windows"')
  })

  test("maps all arches in postinstall.mjs", () => {
    expect(postinstall).toContain('x64: "x64"')
    expect(postinstall).toContain('arm64: "arm64"')
  })

  test("handles windows platform in supportsAvx2", () => {
    expect(postinstall).toContain('if (windows)')
  })
})
