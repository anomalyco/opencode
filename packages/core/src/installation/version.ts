declare global {
  const ARGUS_VERSION: string
  const ARGUS_CHANNEL: string
}

export const InstallationVersion = typeof ARGUS_VERSION === "string" ? ARGUS_VERSION : "local"
export const InstallationChannel = typeof ARGUS_CHANNEL === "string" ? ARGUS_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
