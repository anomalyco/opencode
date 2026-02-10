import { $ } from "bun"
import fs from "fs"
import fsp from "fs/promises"
import os from "os"
import path from "path"

export const SUPPORTED_BRANCHES = ["dev", "beta"] as const
export type SupportedBranch = (typeof SUPPORTED_BRANCHES)[number]

export function assertSupportedBranch(branch: string): asserts branch is SupportedBranch {
  if (!SUPPORTED_BRANCHES.includes(branch as SupportedBranch)) {
    throw new Error(`Invalid branch '${branch}'. Use one of: ${SUPPORTED_BRANCHES.join(", ")}`)
  }
}

export function resolveRepoRoot() {
  const envRoot = process.env.OPENCODE_DIR
  if (envRoot) return envRoot

  const candidates = [
    process.cwd(),
    path.resolve(process.execPath, "../../../../../.."),
    path.resolve(process.execPath, "../../../../.."),
  ]

  for (const candidate of candidates) {
    const root = findRepoRoot(candidate)
    if (root) return root
  }

  throw new Error("Could not locate opencode repository root. Set OPENCODE_DIR to your fork path.")
}

function findRepoRoot(start: string) {
  let current = path.resolve(start)
  while (true) {
    if (isRepoRoot(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function isRepoRoot(dir: string) {
  return (
    fs.existsSync(path.join(dir, ".git")) &&
    fs.existsSync(path.join(dir, "packages", "opencode")) &&
    fs.existsSync(path.join(dir, "packages", "desktop"))
  )
}

export function linuxTarget() {
  if (process.platform !== "linux") {
    throw new Error("Desktop build is currently supported only on Linux.")
  }

  if (process.arch === "x64") return "x86_64-unknown-linux-gnu"
  if (process.arch === "arm64") return "aarch64-unknown-linux-gnu"

  throw new Error(`Unsupported Linux arch '${process.arch}'.`)
}

export async function installDeps(repoRoot: string) {
  await $`bun install`.cwd(repoRoot)
}

export async function buildTui(repoRoot: string) {
  await $`bun run script/build.ts --single`.cwd(path.join(repoRoot, "packages", "opencode"))
}

export async function buildDesktop(repoRoot: string) {
  return withDesktopBuildLock(repoRoot, async () => {
    const target = linuxTarget()

    await $`bun run ./scripts/predev.ts`
      .cwd(path.join(repoRoot, "packages", "desktop"))
      .env({
        ...process.env,
        RUST_TARGET: target,
      })

    await $`bun run tauri build --target ${target} --config ./src-tauri/tauri.local.conf.json`.cwd(
      path.join(repoRoot, "packages", "desktop"),
    )

    return target
  })
}

async function withDesktopBuildLock<T>(repoRoot: string, fn: () => Promise<T>) {
  const lockDir = path.join(repoRoot, ".git", ".opencode-desktop-build.lock")
  const pidFile = path.join(lockDir, "pid")

  while (true) {
    try {
      await fsp.mkdir(lockDir)
      await fsp.writeFile(pidFile, String(process.pid))
      break
    } catch (error) {
      const e = error as NodeJS.ErrnoException
      if (e.code !== "EEXIST") throw error

      const stale = await isStaleDesktopBuildLock(pidFile)
      if (stale) {
        await fsp.rm(lockDir, { recursive: true, force: true })
        continue
      }

      await Bun.sleep(500)
    }
  }

  try {
    return await fn()
  } finally {
    await fsp.rm(lockDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function isStaleDesktopBuildLock(pidFile: string) {
  const pidText = await fsp.readFile(pidFile, "utf8").catch(() => "")
  const pid = Number.parseInt(pidText.trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return true

  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

export async function detectCurrentBranch(repoRoot: string) {
  const branch = (await $`git branch --show-current`.cwd(repoRoot).text()).trim()
  return branch
}

async function hasRemoteBranch(repoRoot: string, remoteRef: string) {
  const result = await $`git show-ref --verify --quiet refs/remotes/${remoteRef}`.cwd(repoRoot).nothrow()
  return result.exitCode === 0
}

async function hasLocalBranch(repoRoot: string, branch: string) {
  const result = await $`git show-ref --verify --quiet refs/heads/${branch}`.cwd(repoRoot).nothrow()
  return result.exitCode === 0
}

export async function checkoutAndRebase(repoRoot: string, branch: SupportedBranch) {
  await $`git fetch upstream`.cwd(repoRoot)
  await $`git fetch origin`.cwd(repoRoot).nothrow()

  const localExists = await hasLocalBranch(repoRoot, branch)
  if (localExists) {
    await $`git checkout ${branch}`.cwd(repoRoot)
  } else if (await hasRemoteBranch(repoRoot, `origin/${branch}`)) {
    await $`git checkout -b ${branch} --track origin/${branch}`.cwd(repoRoot)
  } else {
    await $`git checkout -b ${branch} upstream/${branch}`.cwd(repoRoot)
  }

  await $`git rebase upstream/${branch}`.cwd(repoRoot)
}

export async function pushBranch(repoRoot: string, branch: SupportedBranch) {
  await $`git push origin ${branch} --force-with-lease`.cwd(repoRoot)
}

export async function findDesktopBinary(repoRoot: string) {
  const target = linuxTarget()
  const releaseDir = path.join(repoRoot, "packages", "desktop", "src-tauri", "target", target, "release")
  const candidates = ["OpenCode", "opencode-desktop"].map((name) => path.join(releaseDir, name))

  for (const candidate of candidates) {
    const stat = await fsp
      .stat(candidate)
      .then((x) => x)
      .catch(() => null)
    if (stat?.isFile()) return candidate
  }

  return null
}

export function resolveBuiltCliBinaryPath(repoRoot: string) {
  const platformMap: Record<string, string> = {
    linux: "linux",
    darwin: "darwin",
  }
  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
  }

  const platform = platformMap[process.platform]
  const arch = archMap[process.arch]
  if (!platform || !arch) {
    throw new Error(`Unsupported platform/arch: ${process.platform}/${process.arch}`)
  }

  return path.join(repoRoot, "packages", "opencode", "dist", `opencode-${platform}-${arch}`, "bin", "opencode")
}

export async function installLocalDesktopIntegration(repoRoot: string, binaryPath: string) {
  const home = os.homedir()
  const binDir = path.join(home, ".local", "bin")
  const symlinkPath = path.join(binDir, "opencode")

  const appsDir = path.join(home, ".local", "share", "applications")
  const desktopEntryPath = path.join(appsDir, "opencode.desktop")

  const iconDir = path.join(home, ".local", "share", "icons", "hicolor", "128x128", "apps")
  const iconPath = path.join(iconDir, "opencode.png")

  const sourceIconPath = path.join(repoRoot, "packages", "desktop", "src-tauri", "icons", "prod", "128x128.png")

  await fsp.mkdir(binDir, { recursive: true })
  await fsp.rm(symlinkPath, { force: true })
  await fsp.symlink(binaryPath, symlinkPath)

  await fsp.mkdir(appsDir, { recursive: true })
  await fsp.mkdir(iconDir, { recursive: true })
  await fsp.copyFile(sourceIconPath, iconPath)

  const desktopEntry = `[Desktop Entry]
Type=Application
Version=1.0
Name=OpenCode
Comment=Open source AI coding agent
Exec=opencode desktop
TryExec=opencode
Icon=opencode
Terminal=false
Categories=Development;
MimeType=x-scheme-handler/opencode;
StartupNotify=true
`

  await fsp.writeFile(desktopEntryPath, desktopEntry)

  await $`update-desktop-database ${appsDir}`.nothrow()
  await $`gtk-update-icon-cache -f -t ${path.join(home, ".local", "share", "icons", "hicolor")}`.nothrow()

  return {
    symlinkPath,
    desktopEntryPath,
  }
}
