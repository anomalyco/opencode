import { semver } from "bun"
import { Log } from "../util/log"

export namespace PackageRegistry {
  const log = Log.create({ service: "bun" })

  /**
   * Query npm registry directly via HTTP instead of `bun info` to avoid
   * bun's registry cache returning stale version data.
   */
  export async function latest(pkg: string): Promise<string | null> {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!res?.ok) {
      log.warn("registry fetch failed", { pkg, status: res?.status })
      return null
    }
    const data = (await res.json().catch(() => null)) as { version?: string } | null
    return data?.version ?? null
  }

  export async function isOutdated(pkg: string, cached: string): Promise<boolean> {
    const version = await latest(pkg)
    if (!version) {
      log.warn("failed to resolve latest version, using cached", { pkg, cached })
      return false
    }

    if (/[\s^~*xX<>|=]/.test(cached)) return !semver.satisfies(version, cached)

    return semver.order(cached, version) === -1
  }
}
