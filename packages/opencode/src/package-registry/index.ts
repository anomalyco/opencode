import semver from "semver"
import { BunProc } from "../bun"
import { Log } from "../util/log"

export namespace PackageRegistry {
  const log = Log.create({ service: "npm" })

  export async function getLatestVersion(pkg: string, cwd?: string): Promise<string | null> {
    const version = await BunProc.info(pkg, "version", cwd)
    if (version) return version
    log.warn("Failed to resolve latest version using bun info", { pkg })
    return null
  }

  export function compareVersions(left: string, right: string): number {
    const l = semver.coerce(semver.clean(left) ?? left)?.version
    const r = semver.coerce(semver.clean(right) ?? right)?.version
    if (!l || !r) return 0
    return semver.compare(l, r)
  }

  export async function isOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
    const latestVersion = await getLatestVersion(pkg, cwd)
    if (!latestVersion) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }
    return compareVersions(cachedVersion, latestVersion) < 0
  }
}
