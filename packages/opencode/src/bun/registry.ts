import semver from "semver"
import { Log } from "../util/log"
import { Process } from "../util/process"

export namespace PackageRegistry {
  const log = Log.create({ service: "bun" })

  function which() {
    return process.execPath
  }

  export async function info(pkg: string, field: string, cwd?: string): Promise<string | null> {
    const { code, stdout, stderr } = await Process.run([which(), "info", pkg, field], {
      cwd,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
      nothrow: true,
    })

    if (code !== 0) {
      log.warn("bun info failed", { pkg, field, code, stderr: stderr.toString() })
      return null
    }

    const value = stdout.toString().trim()
    if (!value) return null
    return value
  }

  export async function isOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
    // Guard against non-SemVer cached versions (e.g., "latest", "unknown", etc.)
    // These should never exist in cache but may from previous buggy versions
    const isSemVer = /^\d+\.\d+\.\d+/.test(cachedVersion)
    if (!isSemVer) {
      log.warn("Cached version is not valid SemVer, treating as outdated for reinstall", { pkg, cachedVersion })
      return true
    }

    const latestVersion = await info(pkg, "version", cwd)
    if (!latestVersion) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }

    const isRange = /[\s^~*xX<>|=]/.test(cachedVersion)
    if (isRange) return !semver.satisfies(latestVersion, cachedVersion)

    return semver.lt(cachedVersion, latestVersion)
  }
}
