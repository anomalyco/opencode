import semver from "semver"

export namespace SemVer {
  export function compare(left: string, right: string): number {
    const l = semver.coerce(semver.clean(left) ?? left)?.version
    const r = semver.coerce(semver.clean(right) ?? right)?.version
    if (!l || !r) return 0
    return semver.compare(l, r)
  }
}
