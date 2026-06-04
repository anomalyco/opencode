import semver from "semver"

declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"

export function normalizeInstallationDependencyVersion(version: string) {
  const parsed = semver.parse(version)
  if (!parsed) return version
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`
}

export const InstallationDependencyVersion = normalizeInstallationDependencyVersion(InstallationVersion)
