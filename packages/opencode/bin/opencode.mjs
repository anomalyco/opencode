#!/usr/bin/env node

import { spawn, spawnSync } from "child_process"
import { existsSync, readFileSync, realpathSync } from "fs"
import { join, dirname } from "path"
import { env } from "process"

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"]

function printCorruptError(target) {
  const line = "-".repeat(50)
  console.error(`\n${line}`)
  console.error("OpenCode installation is incomplete.")
  console.error("")
  console.error("The platform executable is missing or corrupted.")
  console.error("")
  console.error("The file at the following location is not a valid executable:")
  console.error(`  ${target}`)
  console.error("")
  console.error("This usually means the postinstall step did not complete successfully.")
  console.error("To fix this, reinstall without --ignore-scripts:")
  console.error("  npm install -g opencode-ai")
  console.error("")
  console.error("Or run the postinstall script manually:")
  console.error("  cd node_modules/opencode-ai && node postinstall.mjs")
  console.error(`${line}\n`)
}

function run(target, args) {
  let child
  try {
    child = spawn(target, args, { stdio: "inherit" })
  } catch (error) {
    printCorruptError(target)
    process.exit(1)
  }

  child.on("error", (error) => {
    if (error.code === "UNKNOWN" || error.code === "EINVAL" || error.code === "EBADF") {
      printCorruptError(target)
    } else {
      console.error(`Failed to start OpenCode: ${error.message}`)
    }
    process.exit(1)
  })

  for (const signal of forwardedSignals) {
    process.on(signal, () => {
      try { child.kill(signal) } catch {}
    })
  }

  child.on("exit", (code, signal) => {
    for (const s of forwardedSignals) {
      process.removeAllListeners(s)
    }
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(typeof code === "number" ? code : 0)
  })
}

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" }
const archMap = { x64: "x64", arm64: "arm64", arm: "arm" }

const osPlatform = platformMap[process.platform] ?? process.platform
const osArch = archMap[process.arch] ?? process.arch
const base = `opencode-${osPlatform}-${osArch}`
const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode"

function supportsAvx2() {
  if (osArch !== "x64") return false
  if (osPlatform === "linux") {
    try { return /(^|\s)avx2(\s|$)/i.test(readFileSync("/proc/cpuinfo", "utf8")) } catch { return false }
  }
  if (osPlatform === "darwin") {
    try {
      const r = spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], { encoding: "utf8", timeout: 1500 })
      if (r.status !== 0) return false
      return (r.stdout || "").trim() === "1"
    } catch { return false }
  }
  if (osPlatform === "windows") {
    const cmd = '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", timeout: 3000, windowsHide: true })
        if (r.status !== 0) continue
        const out = (r.stdout || "").trim().toLowerCase()
        if (out === "true" || out === "1") return true
        if (out === "false" || out === "0") return false
      } catch { continue }
    }
    return false
  }
  return false
}

function isMusl() {
  if (osPlatform !== "linux") return false
  try { if (existsSync("/etc/alpine-release")) return true } catch {}
  try {
    const r = spawnSync("ldd", ["--version"], { encoding: "utf8" })
    return `${r.stdout || ""}${r.stderr || ""}`.toLowerCase().includes("musl")
  } catch { return false }
}

function packageNames() {
  const avx2 = supportsAvx2()
  const baseline = osArch === "x64" && !avx2

  if (osPlatform === "linux") {
    if (isMusl()) {
      if (osArch === "x64") {
        if (baseline) return [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
        return [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      }
      return [`${base}-musl`, base]
    }
    if (osArch === "x64") {
      if (baseline) return [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
      return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    }
    return [base, `${base}-musl`]
  }

  if (osArch === "x64") {
    if (baseline) return [`${base}-baseline`, base]
    return [base, `${base}-baseline`]
  }
  return [base]
}

function findInNodeModules(startDir) {
  let current = startDir
  while (true) {
    const modulesDir = join(current, "node_modules")
    if (existsSync(modulesDir)) {
      for (const name of packageNames()) {
        const candidate = join(modulesDir, name, "bin", binaryName)
        if (existsSync(candidate)) return candidate
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

const scriptDir = dirname(realpathSync(process.argv[1]))
const postinstallBinary = join(scriptDir, binaryName)
const resolved =
  env.OPENCODE_BIN_PATH ||
  (existsSync(postinstallBinary) ? postinstallBinary : null) ||
  findInNodeModules(scriptDir)

if (!resolved || !existsSync(resolved)) {
  const line = "-".repeat(50)
  console.error(`\n${line}`)
  console.error("OpenCode installation is incomplete.")
  console.error("")
  console.error("The platform executable has not been installed.")
  console.error("")
  console.error("This usually means the postinstall step did not complete successfully.")
  console.error("This can happen when:")
  console.error("  - Using --ignore-scripts during npm installation")
  console.error("  - Using a package manager like pnpm that requires explicit postinstall")
  console.error("  - The download was interrupted or failed")
  console.error("  - Antivirus software removed the binary")
  console.error("  - The platform package is missing from node_modules")
  console.error("")
  console.error("To fix this, reinstall without --ignore-scripts:")
  console.error("  npm install -g opencode-ai")
  console.error("")
  console.error("Or run the postinstall script manually:")
  console.error("  cd node_modules/opencode-ai && node postinstall.mjs")
  console.error(`${line}\n`)
  process.exit(1)
}

run(resolved, process.argv.slice(2))
