import semver from "semver"
import type { DiscoverOptions } from "./service.js"

export function matchesVersion(version: string | undefined, options: DiscoverOptions) {
  if (options.version === undefined) return true
  if (version === undefined) return false
  const range = semver.validRange(options.version)
  if (range === null) return version === options.version
  return semver.satisfies(version, range, { includePrerelease: true })
}
