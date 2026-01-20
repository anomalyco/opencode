import { Log } from "../util/log"

export namespace Npm {
  const log = Log.create({ service: "npm" })

  export async function getLatestVersion(pkg: string): Promise<string | null> {
    const encoded = pkg.replace("/", "%2F")
    const url = `https://registry.npmjs.org/${encoded}/latest`
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    }).catch(() => null)

    if (!response) {
      log.warn("Failed to fetch latest version from registry", { pkg })
      return null
    }

    if (!response.ok) {
      log.warn("Failed to fetch latest version from registry", { pkg, status: response.status })
      return null
    }

    const data = (await response.json().catch(() => null)) as { version?: string } | null
    if (!data?.version) return null
    return data.version
  }

  export function compareVersions(left: string, right: string): number {
    const leftParts = left.split(".").map((part) => parseInt(part, 10) || 0)
    const rightParts = right.split(".").map((part) => parseInt(part, 10) || 0)
    const length = Math.max(leftParts.length, rightParts.length)

    for (let i = 0; i < length; i++) {
      const leftValue = leftParts[i] ?? 0
      const rightValue = rightParts[i] ?? 0
      if (leftValue < rightValue) return -1
      if (leftValue > rightValue) return 1
    }

    return 0
  }

  export async function isOutdated(pkg: string, cachedVersion: string): Promise<boolean> {
    const latestVersion = await getLatestVersion(pkg)
    if (!latestVersion) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }
    return compareVersions(cachedVersion, latestVersion) < 0
  }
}
