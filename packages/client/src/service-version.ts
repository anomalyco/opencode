import type { DiscoverOptions } from "./service.js"

export function matchesVersion(version: string | undefined, options: DiscoverOptions) {
  if (options.version === undefined) return true
  if (version === undefined) return false
  if (typeof options.version === "function") return options.version(version)
  return version === options.version
}

/**
 * A version requirement met by a service at least as new as `version`, for clients that can use a newer service, so
 * an older client keeps the service a newer one started instead of replacing it. Stable releases compare by version
 * and preview builds (`0.0.0-<channel>-<run>`) by run within their channel. Builds from different lines cannot be
 * ordered, so a service from another line is kept; a version of neither form must match exactly.
 */
export function atLeast(version: string) {
  const client = release(version)
  return (service: string) => {
    if (service === version) return true
    const running = release(service)
    if (!client || !running) return false
    if (client.line !== running.line) return true
    return compare(running.parts, client.parts) >= 0
  }
}

function release(version: string) {
  const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (stable) return { line: "", parts: stable.slice(1).map(Number) }
  const preview = /^0\.0\.0-(.+)-(\d+)(?:\.(\d+))?$/.exec(version)
  if (preview) return { line: preview[1], parts: [Number(preview[2]), Number(preview[3] ?? 0)] }
}

function compare(left: number[], right: number[]) {
  return left.reduce((result, part, index) => result || part - right[index], 0)
}
