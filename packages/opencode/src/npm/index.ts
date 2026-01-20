import { Log } from "../util/log"

export namespace Npm {
  const log = Log.create({ service: "npm" })

  export async function getLatestVersion(pkg: string): Promise<string | null> {
    try {
      const encodedPkg = pkg.replace("/", "%2F")
      const registryUrl = `https://registry.npmjs.org/${encodedPkg}/latest`
      const response = await fetch(registryUrl, {
        headers: { Accept: "application/json" },
      })
      if (!response.ok) {
        log.warn("Failed to fetch latest version from registry", { pkg, status: response.status })
        return null
      }
      const data = (await response.json()) as { version?: string }
      return data.version ?? null
    } catch (error) {
      log.warn("Error fetching latest version from registry", { pkg, error })
      return null
    }
  }

  export function compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map((x) => parseInt(x, 10) || 0)
    const parts2 = v2.split(".").map((x) => parseInt(x, 10) || 0)
    const maxLen = Math.max(parts1.length, parts2.length)
    for (let i = 0; i < maxLen; i++) {
      const a = parts1[i] ?? 0
      const b = parts2[i] ?? 0
      if (a < b) return -1
      if (a > b) return 1
    }
    return 0
  }

  export async function isOutdated(pkg: string, cachedVersion: string): Promise<boolean> {
    const latestVersion = await getLatestVersion(pkg)
    if (!latestVersion) {
      return true
    }
    return compareVersions(cachedVersion, latestVersion) < 0
  }
}
