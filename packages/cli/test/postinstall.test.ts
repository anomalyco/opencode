import { describe, expect, test } from "bun:test"
import childProcess from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const script = path.resolve(import.meta.dir, "../script/postinstall.mjs")

// The launcher is a plain script that exits when it finishes, so each case runs a copy of it as a child process. The
// copy sits beside a package for the running platform whose `bin/` is still empty, which is the state a fresh install
// starts from: the package is there but the binary is not, so the launcher has to install the package with npm.
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opencode-postinstall-")))
  const platform = ({ win32: "windows" } as Record<string, string>)[process.platform] ?? process.platform
  const name = `@opencode/cli-${platform}-${process.arch}`
  const directory = path.join(root, "script")
  fs.mkdirSync(path.join(root, "node_modules", name, "bin"), { recursive: true })
  fs.mkdirSync(path.join(directory, "bin"), { recursive: true })
  fs.writeFileSync(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ name }))
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "@opencode/cli",
      version: "0.0.0",
      opencodeSourceBinary: "opencode",
      bin: { opencode: "./bin/opencode" },
      optionalDependencies: { [name]: "0.0.0" },
    }),
  )
  return {
    root,
    directory,
    launcher: path.join(directory, "postinstall.mjs"),
    recorded: path.join(root, "npm-command.json"),
  }
}

type Fixture = ReturnType<typeof fixture>

// The copy writes `npm` down and takes over the install, so a case sees the command without asking npm to install
// anything. The shipped `installPackage` is replaced by a stub, which keeps the `npm` the launcher edits in place.
function recorded(source: string, recordedPath: string) {
  const start = source.indexOf("function installPackage(name) {")
  const end = source.indexOf("function verifyBinary() {")
  const stub = [
    "function installPackage() {",
    `  fs.writeFileSync(${JSON.stringify(recordedPath)}, JSON.stringify(npm))`,
    "  return false",
    "}",
    "",
  ].join("\n")
  return `${source.slice(0, start)}${stub}${source.slice(end)}`
}

// Runs the launcher copy with npm's own executable, which is a node: npm gives scripts `process.execPath` of that node
// and its CLI in npm_execpath, and neither is a `.cmd` shim a Windows spawn can start.
function launched(files: Fixture, source: string, runtime: string, env: Record<string, string> = {}) {
  fs.writeFileSync(files.launcher, source)
  return childProcess.spawnSync(runtime, [files.launcher], { encoding: "utf8", env: { ...process.env, ...env } })
}

function commandIn(files: Fixture) {
  return JSON.parse(fs.readFileSync(files.recorded, "utf8")) as string[]
}

function cleaned(files: Fixture) {
  fs.rmSync(files.root, { recursive: true, force: true })
}

// Windows cannot start npm's `.cmd` shim, so the launcher has to name the npm CLI that runs npm scripts: the one beside
// the node executable and named by npm_execpath.
describe.skipIf(process.platform !== "win32")("npm command", () => {
  test("starts the npm CLI beside node", () => {
    const files = fixture()
    try {
      const runtime = path.join(files.directory, "node.exe")
      const npmCli = path.join(files.directory, "node_modules", "npm", "bin", "npm-cli.js")
      fs.copyFileSync(process.execPath, runtime)
      fs.mkdirSync(path.dirname(npmCli), { recursive: true })
      fs.writeFileSync(npmCli, "")
      launched(files, recorded(fs.readFileSync(script, "utf8"), files.recorded), process.execPath, {
        npm_execpath: npmCli,
      })
      expect(commandIn(files)).toEqual([process.execPath, npmCli, "npm"])
    } finally {
      cleaned(files)
    }
  })

  test("reports why npm could not be started", () => {
    const files = fixture()
    try {
      const missing = path.join(files.root, "missing", "npm-cli.js")
      const source = fs
        .readFileSync(script, "utf8")
        .replace(/^const npm = \["npm"\]$/m, () => `const npm = [${JSON.stringify(missing)}]`)
      const result = launched(files, source, process.execPath)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("npm could not be started: ENOENT")
      expect(result.status).toBe(1)
      expect(fs.existsSync(files.recorded)).toBe(false)
    } finally {
      cleaned(files)
    }
  })
})
