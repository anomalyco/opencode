import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Lock } from "../util/lock"
import { Npm } from "../npm"
import { online, proxied } from "@/util/network"
import { Process } from "../util/process"

export namespace BunProc {
  const log = Log.create({ service: "bun" })

  export async function run(cmd: string[], options?: Process.RunOptions) {
    const full = [which(), ...cmd]
    log.info("running", {
      cmd: full,
      ...options,
    })
    const result = await Process.run(full, {
      cwd: options?.cwd,
      abort: options?.abort,
      kill: options?.kill,
      timeout: options?.timeout,
      nothrow: options?.nothrow,
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    log.info("done", {
      code: result.code,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    return result
  }

  export function which() {
    return process.execPath
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  // For github: dependencies, bun installs under the package's actual name
  // (from its package.json "name" field), not under the github: specifier.
  // Resolve the real module path by reading the installed package name from
  // the cache lockfile.
  async function resolveModulePath(pkg: string): Promise<string> {
    const nodeModules = path.join(Global.Path.cache, "node_modules")
    if (!pkg.startsWith("github:")) return path.join(nodeModules, pkg)
    const lockPath = path.join(Global.Path.cache, "bun.lock")
    const lock = await Filesystem.readText(lockPath).catch(() => "")
    // lockfile maps "actual-name": "github:owner/repo#ref"
    for (const line of lock.split("\n")) {
      if (line.includes(pkg)) {
        const match = line.match(/^\s*"([^"]+)":\s*"/)
        if (match && match[1] !== pkg) return path.join(nodeModules, match[1])
      }
    }
    // Fallback: strip github: prefix and use repo name
    const repoName = pkg
      .replace(/^github:/, "")
      .split("#")[0]
      .split("/")
      .pop()
    if (repoName) return path.join(nodeModules, repoName)
    return path.join(nodeModules, pkg)
  }

  export async function install(pkg: string, version = "latest") {
    // Use lock to ensure only one install at a time
    using _ = await Lock.write("bun-install")

    const mod = await resolveModulePath(pkg)
    const pkgjsonPath = path.join(Global.Path.cache, "package.json")
    const parsed = await Filesystem.readJson<{ dependencies: Record<string, string> }>(pkgjsonPath).catch(async () => {
      const result = { dependencies: {} as Record<string, string> }
      await Filesystem.writeJson(pkgjsonPath, result)
      return result
    })
    if (!parsed.dependencies) parsed.dependencies = {} as Record<string, string>
    const dependencies = parsed.dependencies
    const modExists = await Filesystem.exists(mod)
    const cachedVersion = dependencies[pkg]

    if (!modExists || !cachedVersion) {
      // continue to install
    } else if (version === "latest") {
      if (!online()) return mod
      const stale = await Npm.outdated(pkg, cachedVersion)
      if (!stale) return mod
      log.info("Cached version is outdated, proceeding with install", { pkg, cachedVersion })
    } else if (cachedVersion === version) {
      return mod
    }

    // Build command arguments
    const args = [
      "add",
      "--force",
      "--exact",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied() || process.env.CI ? ["--no-cache"] : []),
      "--cwd",
      Global.Path.cache,
      pkg.includes("#") ? pkg : pkg + "@" + version,
    ]

    // Let Bun handle registry resolution:
    // - If .npmrc files exist, Bun will use them automatically
    // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
    // - No need to pass --registry flag
    log.info("installing package using Bun's default registry resolution", {
      pkg,
      version,
    })

    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })

    // Re-resolve after install in case lockfile changed
    const installedMod = await resolveModulePath(pkg)

    // Resolve actual version from installed package when using "latest"
    // This ensures subsequent starts use the cached version until explicitly updated
    let resolvedVersion = version
    if (version === "latest") {
      const installedPkg = await Filesystem.readJson<{ version?: string }>(
        path.join(installedMod, "package.json"),
      ).catch(() => null)
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
      }
    }

    parsed.dependencies[pkg] = resolvedVersion
    await Filesystem.writeJson(pkgjsonPath, parsed)
    return installedMod
  }
}
