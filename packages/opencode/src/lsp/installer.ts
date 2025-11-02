import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { BunProc } from "../bun"
import { $ } from "bun"

export namespace LSPInstaller {
  const log = Log.create({ service: "lsp.installer" })

  const downloadLocks = new Map<string, Promise<void>>()

  async function downloadWithLock<T>(
    id: string,
    download: () => Promise<T>,
  ): Promise<T | undefined> {
    const existing = downloadLocks.get(id)
    if (existing) {
      await existing
      return undefined
    }

    const promise = download().finally(() => downloadLocks.delete(id))
    downloadLocks.set(id, promise as Promise<void>)
    return promise
  }

  export interface NPMPackageOptions {
    packageName: string
    entryPoint: string
    binaryName?: string
  }

  export async function installNPMPackage(options: NPMPackageOptions): Promise<string> {
    if (options.binaryName) {
      const bin = Bun.which(options.binaryName)
      if (bin) return bin
    }

    const js = path.join(Global.Path.bin, "node_modules", ...options.entryPoint.split("/"))

    if (!(await Bun.file(js).exists())) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) {
        throw new Error(`LSP download disabled: ${options.packageName}`)
      }

      log.info(`installing ${options.packageName}`)

      const result = await downloadWithLock(options.packageName, async () => {
        await Bun.spawn([BunProc.which(), "install", options.packageName], {
          cwd: Global.Path.bin,
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
        }).exited
      })

      if (result === undefined && !(await Bun.file(js).exists())) {
        throw new Error(`LSP download completed but binary not found: ${js}`)
      }

      log.info(`installed ${options.packageName}`, { path: js })
    }

    return js
  }

  export interface GitHubReleaseOptions {
    repo: string
    assetNamePattern: (release: any, platform: string, arch: string) => string
    extractedBinaryPath: (extractedDir: string, platform: string, arch: string) => string
    supportedPlatforms?: string[]
  }

  export async function installFromGitHub(options: GitHubReleaseOptions): Promise<string> {
    const platform = process.platform
    const arch = process.arch

    if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) {
      throw new Error(`LSP download disabled: ${options.repo}`)
    }

    log.info(`downloading from GitHub releases: ${options.repo}`)

    const releaseResponse = await fetch(
      `https://api.github.com/repos/${options.repo}/releases/latest`,
    )
    if (!releaseResponse.ok) {
      throw new Error(`Failed to fetch release info for ${options.repo}`)
    }

    const release = await releaseResponse.json()
    const assetName = options.assetNamePattern(release, platform, arch)

    const asset = release.assets.find((a: any) => a.name === assetName)
    if (!asset) {
      throw new Error(`Could not find asset ${assetName} in latest ${options.repo} release`)
    }

    const downloadUrl = asset.browser_download_url
    const downloadResponse = await fetch(downloadUrl)
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download ${assetName}`)
    }

    const tempPath = path.join(Global.Path.bin, assetName)
    await Bun.file(tempPath).write(downloadResponse)

    if (assetName.endsWith(".zip")) {
      await $`unzip -o -q ${tempPath}`.quiet().cwd(Global.Path.bin).nothrow()
    } else if (assetName.endsWith(".tar.gz") || assetName.endsWith(".tar.xz")) {
      await $`tar -xf ${tempPath}`.cwd(Global.Path.bin).nothrow()
    }

    await Bun.file(tempPath).delete()

    const extractedDir = path.join(
      Global.Path.bin,
      assetName.replace(/\.(zip|tar\.gz|tar\.xz)$/, ""),
    )
    const bin = options.extractedBinaryPath(extractedDir, platform, arch)

    if (!(await Bun.file(bin).exists())) {
      throw new Error(`Failed to extract binary: ${bin}`)
    }

    if (platform !== "win32") {
      await $`chmod +x ${bin}`.nothrow()
    }

    log.info(`installed from GitHub`, { repo: options.repo, bin })
    return bin
  }

  export interface GoPackageOptions {
    packagePath: string
    binaryName: string
  }

  export async function installGoPackage(options: GoPackageOptions): Promise<string> {
    let bin = Bun.which(options.binaryName, {
      PATH: process.env["PATH"] + ":" + Global.Path.bin,
    })

    if (!bin) {
      if (!Bun.which("go")) {
        throw new Error("Go is required to install " + options.binaryName)
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) {
        throw new Error(`LSP download disabled: ${options.packagePath}`)
      }

      log.info(`installing ${options.binaryName} via go install`)

      const proc = Bun.spawn({
        cmd: ["go", "install", options.packagePath],
        env: { ...process.env, GOBIN: Global.Path.bin },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })

      const exit = await proc.exited
      if (exit !== 0) {
        throw new Error(`Failed to install ${options.binaryName}`)
      }

      bin = path.join(
        Global.Path.bin,
        options.binaryName + (process.platform === "win32" ? ".exe" : ""),
      )
      log.info(`installed ${options.binaryName}`, { bin })
    }

    return bin
  }
}
