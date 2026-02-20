import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@opencode-ai/util/error"
import { readableStreamToText } from "bun"
import { Lock } from "../util/lock"
import { PackageRegistry } from "./registry"
import { proxied } from "@/util/proxied"

export namespace BunProc {
  const log = Log.create({ service: "bun" })

  export async function run(cmd: string[], options?: Bun.SpawnOptions.OptionsObject<any, any, any>) {
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    const code = await result.exited
    const stdout = result.stdout
      ? typeof result.stdout === "number"
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined
    const stderr = result.stderr
      ? typeof result.stderr === "number"
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined
    log.info("done", {
      code,
      stdout,
      stderr,
    })
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}`)
    }
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

  export async function install(pkg: string, version = "latest") {
    // Use lock to ensure only one install at a time
    using _ = await Lock.write("bun-install")

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
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
    } else if (version !== "latest" && cachedVersion === version) {
      return mod
    } else if (version === "latest") {
      // Validate cached version is a proper SemVer before checking if outdated
      // Prevents errors from corrupted cache with invalid versions like "latest"
      const isValidSemVer = /^\d+\.\d+\.\d+/.test(cachedVersion)
      if (!isValidSemVer) {
        log.warn("Cached version is not valid SemVer, removing and reinstalling", { pkg, cachedVersion })
        delete dependencies[pkg]
      } else {
        const isOutdated = await PackageRegistry.isOutdated(pkg, cachedVersion, Global.Path.cache)
        if (!isOutdated) return mod
        log.info("Cached version is outdated, proceeding with install", { pkg, cachedVersion })
      }
    }

    // Build command arguments
    const args = [
      "add",
      "--force",
      "--exact",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied() ? ["--no-cache"] : []),
      "--cwd",
      Global.Path.cache,
      pkg + "@" + version,
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

    // Resolve actual version from installed package to cache a real SemVer
    // This ensures subsequent starts use the cached version instead of querying npm each time
    let resolvedVersion = version
    if (version === "latest") {
      const installedPkg = await Filesystem.readJson<{ version?: string }>(path.join(mod, "package.json")).catch(
        () => null,
      )
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
        log.info("Resolved 'latest' to actual version", { pkg, resolvedVersion })
      } else {
        log.error("Failed to read version from installed package, cannot cache", { pkg, modPath: mod })
      }
    }
    
    // Only cache valid SemVer versions
    // Never cache "latest" or any non-SemVer strings as they cause semver parsing errors
    if (resolvedVersion !== "latest" && /^\d+\.\d+\.\d+/.test(resolvedVersion)) {
      parsed.dependencies[pkg] = resolvedVersion
      await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2))
      log.info("Cached resolved version", { pkg, version: resolvedVersion })
    } else if (resolvedVersion === "latest") {
      log.warn("Could not resolve package version from installed package.json, will re-resolve on next run", { pkg })
    }
    return mod
  }
}
