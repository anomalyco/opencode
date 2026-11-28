import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const script = path.resolve(import.meta.dir, "../script/postinstall.mjs")
const platform = process.platform === "win32" ? "windows" : process.platform
const arch =
  platform === "windows" && process.arch === "x64" && process.env.PROCESSOR_IDENTIFIER?.startsWith("ARM")
    ? "arm64"
    : process.arch
const packageName = `@opencode/cli-${platform}-${arch}`

// The published package points its bin at `bin/opencode.exe` on every platform. The launcher copies the platform
// package's binary there, so a test only has to check that file.
function target(files: Fixture) {
  return path.join(files.root, "bin", "opencode.exe")
}

// An unmodified copy of the script, beside a manifest that names the platform packages a case declares.
function fixture(declared: string[]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opencode-postinstall-")))
  fs.copyFileSync(script, path.join(root, "postinstall.mjs"))
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@opencode/cli",
      version: "0.0.0",
      opencodeSourceBinary: "opencode",
      bin: { opencode: "./bin/opencode.exe" },
      optionalDependencies: Object.fromEntries(declared.map((name) => [name, "1.0.0"])),
    }),
  )
  return {
    root,
    launcher: path.join(root, "postinstall.mjs"),
    emptyPath: path.join(root, "empty-path"),
  }
}

type Fixture = ReturnType<typeof fixture>

// Windows treats environment names case-insensitively, so an override has to replace `Path` as well as `PATH`.
function environment(overrides: Record<string, string>) {
  const replaced = new Set(Object.keys(overrides).map((name) => name.toLowerCase()))
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !replaced.has(entry[0].toLowerCase()),
  )
  return { ...Object.fromEntries(inherited), ...overrides }
}

function run(files: Fixture, runtime: string, env: Record<string, string> = {}) {
  return Bun.spawnSync([runtime, files.launcher], {
    cwd: files.root,
    env: environment(env),
    stdout: "pipe",
    stderr: "pipe",
  })
}

// Stands in for `npm install --prefix <temp> <name>@<version>`: it creates the requested platform package with a binary
// that succeeds on `--version`, which is all the launcher verifies before copying it.
function fakeNpm(files: Fixture, npmCli = path.join(files.root, "npm", "bin", "npm-cli.js"), marker?: string) {
  fs.mkdirSync(path.dirname(npmCli), { recursive: true })
  const install =
    process.platform === "win32"
      ? `try { fs.linkSync(process.execPath, path.join(bin, "opencode.exe")) } catch { fs.copyFileSync(process.execPath, path.join(bin, "opencode.exe")) }`
      : `fs.writeFileSync(path.join(bin, "opencode"), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 })`
  fs.writeFileSync(
    npmCli,
    [
      `const fs = require("node:fs")`,
      `const path = require("node:path")`,
      `const args = process.argv.slice(2)`,
      `const prefix = args[args.indexOf("--prefix") + 1]`,
      `const spec = args[args.length - 1]`,
      `const name = spec.slice(0, spec.lastIndexOf("@"))`,
      `const dir = path.join(prefix, "node_modules", name)`,
      `const bin = path.join(dir, "bin")`,
      `fs.mkdirSync(bin, { recursive: true })`,
      `fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }))`,
      install,
      ...(marker ? [`fs.writeFileSync(${JSON.stringify(marker)}, "used")`] : []),
      ``,
    ].join("\n"),
  )
  return npmCli
}

// The running test runtime, copied so a case can place an npm CLI beside it without touching the real installation.
function copyRuntime(files: Fixture) {
  const runtime = path.join(files.root, "runtime", process.platform === "win32" ? "bun.exe" : "bun")
  fs.mkdirSync(path.dirname(runtime), { recursive: true })
  try {
    fs.linkSync(process.execPath, runtime)
  } catch {
    fs.copyFileSync(process.execPath, runtime)
  }
  return runtime
}

function clean(files: Fixture) {
  // Antivirus can briefly hold the copied runtime on Windows.
  fs.rmSync(files.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

describe("postinstall", () => {
  test("starts the npm CLI named by npm_execpath", () => {
    const files = fixture([packageName])
    try {
      const marker = path.join(files.root, "npm-execpath-used")
      const npmCli = fakeNpm(files, path.join(files.root, "npm", "bin", "npm-cli.js"), marker)
      const result = run(files, process.execPath, { npm_execpath: npmCli })
      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(marker)).toBe(true)
      expect(fs.existsSync(target(files))).toBe(true)
    } finally {
      clean(files)
    }
  }, 60_000)

  test.skipIf(process.platform !== "win32")(
    "uses the npm CLI beside the running executable",
    () => {
      const files = fixture([packageName])
      try {
        const runtime = copyRuntime(files)
        const marker = path.join(files.root, "npm-used")
        fakeNpm(files, path.join(path.dirname(runtime), "node_modules", "npm", "bin", "npm-cli.js"), marker)

        const first = run(files, runtime, { npm_execpath: "" })
        expect(first.exitCode).toBe(0)
        expect(fs.existsSync(marker)).toBe(true)
        expect(fs.existsSync(target(files))).toBe(true)

        fs.rmSync(target(files), { force: true })
        fs.rmSync(marker, { force: true })
        const pnpm = path.join(files.root, "pnpm.cjs")
        fs.writeFileSync(
          pnpm,
          `require("node:fs").writeFileSync(${JSON.stringify(path.join(files.root, "pnpm-used"))}, "used")\n`,
        )
        const second = run(files, runtime, { npm_execpath: pnpm })
        expect(second.exitCode).toBe(0)
        expect(fs.existsSync(marker)).toBe(true)
        expect(fs.existsSync(path.join(files.root, "pnpm-used"))).toBe(false)
      } finally {
        clean(files)
      }
    },
    60_000,
  )

  test("reports why npm could not be started and keeps the install hint", () => {
    const files = fixture([packageName])
    try {
      fs.mkdirSync(files.emptyPath)
      const runtime = process.platform === "win32" ? copyRuntime(files) : process.execPath
      const result = run(files, runtime, { npm_execpath: "", PATH: files.emptyPath })
      const stderr = result.stderr.toString()
      expect(result.exitCode).toBe(1)
      expect(stderr).toContain(`Try manually installing "${packageName}"`)
      expect(stderr).toContain("npm could not be started: ENOENT")
    } finally {
      clean(files)
    }
  }, 60_000)

  test.skipIf(process.platform !== "linux" || fs.existsSync("/etc/alpine-release"))(
    "keeps trying installed candidates when npm cannot start",
    () => {
      const installed = `${packageName}-musl`
      const files = fixture([packageName, installed])
      try {
        const directory = path.join(files.root, "node_modules", installed)
        fs.mkdirSync(path.join(directory, "bin"), { recursive: true })
        fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: installed, version: "1.0.0" }))
        fs.writeFileSync(path.join(directory, "bin", "opencode"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
        fs.mkdirSync(files.emptyPath)
        const result = run(files, process.execPath, { npm_execpath: "", PATH: files.emptyPath })
        expect(result.exitCode).toBe(0)
        expect(fs.existsSync(target(files))).toBe(true)
      } finally {
        clean(files)
      }
    },
  )
})
