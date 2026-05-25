import semver from "semver"
import { $ } from "bun"

export namespace PackageRegistry {
  export async function info(pkg: string, field: string, cwd: string) {
    const result = await $`npm view ${pkg} ${field}`.cwd(cwd).quiet().text()
    return result.trim()
  }

  export async function isOutdated(pkg: string, current: string, cwd: string) {
    const latest = await PackageRegistry.info(pkg, "version", cwd)
    if (!semver.valid(latest)) return false
    if (!semver.valid(current) && !semver.validRange(current)) return true
    return !semver.satisfies(latest, current)
  }
}
