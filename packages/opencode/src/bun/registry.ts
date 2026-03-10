import semver from "semver"
import { text } from "node:stream/consumers"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { BunProc } from "."

export namespace PackageRegistry {
  const log = Log.create({ service: "bun" })


  export async function info(pkg: string, field: string, cwd?: string): Promise<string | null> {
    const result = await Process.run([BunProc.which(), "info", pkg, field], {
      cwd,
      env: { ...process.env, BUN_BE_BUN: "1" },
      nothrow: true,
    })

    if (result.code !== 0) {
      log.warn("bun info failed", { pkg, field, code: result.code, stderr: result.stderr.toString() })
      return null
    }

    const value = result.stdout.toString().trim()
    if (!value) return null
    return value
  }

  export async function isOutdated(pkg: string, cachedVersion: string | undefined, cwd?: string): Promise<boolean> {
    if (!cachedVersion) return true

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
