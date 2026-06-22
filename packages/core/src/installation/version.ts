declare global {
  const APEX_VERSION: string
  const APEX_CHANNEL: string
}

export const InstallationVersion = typeof APEX_VERSION === "string" ? APEX_VERSION : "local"
export const InstallationChannel = typeof APEX_CHANNEL === "string" ? APEX_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
