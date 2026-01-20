import { $ } from "bun"
import { Log } from "../util/log"

export namespace Npm {
  const log = Log.create({ service: "npm" })

  export async function getLatestVersion(pkg: string, cwd?: string): Promise<string | null> {
    const registry = await getRegistry(pkg, cwd)
    const encoded = pkg.replace("/", "%2F")
    const url = `${registry}/${encoded}/latest`
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

  export async function isOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean> {
    const latestVersion = await getLatestVersion(pkg, cwd)
    if (!latestVersion) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }
    return compareVersions(cachedVersion, latestVersion) < 0
  }

  async function getRegistry(pkg: string, cwd?: string): Promise<string> {
    const scope = pkg.startsWith("@") ? pkg.split("/")[0] : null
    if (scope) {
      const scoped = await readRegistry(`${scope}:registry`, cwd)
      if (scoped) return scoped
    }
    const registry = await readRegistry("registry", cwd)
    return registry || "https://registry.npmjs.org"
  }

  async function readRegistry(key: string, cwd?: string): Promise<string | null> {
    const command = $`npm config get ${key}`.quiet().nothrow()
    const output = cwd ? await command.cwd(cwd).text() : await command.text()
    const trimmed = output.trim()
    if (!trimmed || trimmed === "undefined") return null
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
  }
}
