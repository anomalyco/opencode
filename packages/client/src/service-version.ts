import type { DiscoverOptions } from "./service.js"

export function matchesVersion(version: string | undefined, options: DiscoverOptions) {
  if (options.version === undefined) return true
  if (version === undefined) return false
  if (typeof options.version === "function") return options.version(version)
  return version === options.version
}

// Ordering that keeps an older client from replacing a newer service. Only
// plain `major.minor.patch` prefixes are ordered; dev builds and prereleases
// fall back to the caller's replacement behavior because they cannot be ranked
// safely against a release.
export function isNewer(version: string, than: string) {
  const left = parse(version)
  const right = parse(than)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return false
}

function parse(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const
}
