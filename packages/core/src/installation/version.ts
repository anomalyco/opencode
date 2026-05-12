declare global {
  const OCTOPUS_VERSION: string
  const OCTOPUS_CHANNEL: string
}

export const InstallationVersion = typeof OCTOPUS_VERSION === "string" ? OCTOPUS_VERSION : "local"
export const InstallationChannel = typeof OCTOPUS_CHANNEL === "string" ? OCTOPUS_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
