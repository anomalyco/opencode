declare global {
  const LEAKCODE_VERSION: string
  const LEAKCODE_CHANNEL: string
}

export const InstallationVersion = typeof LEAKCODE_VERSION === "string" ? LEAKCODE_VERSION : "local"
export const InstallationChannel = typeof LEAKCODE_CHANNEL === "string" ? LEAKCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
