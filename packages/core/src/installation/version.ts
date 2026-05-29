declare global {
  const IMECODE_VERSION: string
  const IMECODE_CHANNEL: string
}

export const InstallationVersion = typeof IMECODE_VERSION === "string" ? IMECODE_VERSION : "local"
export const InstallationChannel = typeof IMECODE_CHANNEL === "string" ? IMECODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
