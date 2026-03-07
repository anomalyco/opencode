#!/usr/bin/env node

const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

function run(target) {
  const result = childProcess.spawnSync(target, process.argv.slice(2), {
    stdio: "inherit",
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  const code = typeof result.status === "number" ? result.status : 0
  process.exit(code)
}

const envPath = process.env.MYSTERYCODE_BIN_PATH || process.env.OPENCODE_BIN_PATH
if (envPath) run(envPath)

const scriptPath = fs.realpathSync(__filename)
const scriptDir = path.dirname(scriptPath)
const cached = path.join(scriptDir, ".mysterycode")
if (fs.existsSync(cached)) run(cached)

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
const archMap = { x64: "x64", arm64: "arm64", arm: "arm" }
const platform = platformMap[os.platform()] || os.platform()
const arch = archMap[os.arch()] || os.arch()
const base = "opencode-" + platform + "-" + arch
const binary = platform === "windows" ? "opencode.exe" : "opencode"

const names = (() => {
  if (platform === "linux") {
    if (arch === "x64") return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    return [base, `${base}-musl`]
  }
  if (arch === "x64") return [base, `${base}-baseline`]
  return [base]
})()

function findBinary(startDir) {
  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    if (fs.existsSync(modules)) {
      for (const name of names) {
        const candidate = path.join(modules, name, "bin", binary)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

const resolved = findBinary(scriptDir)
if (!resolved) {
  console.error("Unable to locate platform binary package for mysterycode.")
  process.exit(1)
}
run(resolved)
