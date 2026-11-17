declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
  const OPENCODE_PLUGIN_VERSION: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
// Version of @opencode-ai/plugin installed into config directories. Builds whose own version is not
// published to npm (forks, custom builds) can pin a published one; otherwise it follows the binary.
export const InstallationPluginVersion =
  typeof OPENCODE_PLUGIN_VERSION === "string" ? OPENCODE_PLUGIN_VERSION : InstallationVersion
