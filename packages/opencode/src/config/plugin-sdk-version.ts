import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"

/**
 * Resolves the version spec used to bootstrap the `@opencode-ai/plugin` SDK
 * into a config directory.
 *
 * Returns `undefined` when the resolved version is missing or holds the dev
 * placeholder `"local"`, so the package manager falls back to the latest
 * published release instead of failing on `@opencode-ai/plugin@local`.
 *
 * `InstallationVersion` defaults to the string `"local"` when the build-time
 * `OPENCODE_VERSION` define is absent (e.g. some local/dev builds). That value
 * is fine for display (User-Agent, telemetry) but is not a valid npm version,
 * and leaking it into the bootstrap install produces a recurring
 * `NpmInstallFailedError` on every config-directory scan.
 */
export function pluginSdkVersion(version: string | undefined, isLocal: boolean): string | undefined {
  if (isLocal) return undefined
  if (!version) return undefined
  if (version === "local") return undefined
  return version
}

/**
 * Convenience binding to the live installation constants. Kept as a thunk so
 * the resolution is testable against arbitrary inputs via {@link pluginSdkVersion}.
 */
export const livePluginSdkVersion = (): string | undefined => pluginSdkVersion(InstallationVersion, InstallationLocal)
