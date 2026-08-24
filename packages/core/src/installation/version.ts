declare global {
  const PENCODE_VERSION: string
  const PENCODE_CHANNEL: string
}

export const InstallationVersion = typeof PENCODE_VERSION === "string" ? PENCODE_VERSION : "local"
export const InstallationChannel = typeof PENCODE_CHANNEL === "string" ? PENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
