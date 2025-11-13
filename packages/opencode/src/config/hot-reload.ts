export function isConfigHotReloadEnabled(): boolean {
  return process.env.OPENCODE_CONFIG_HOT_RELOAD === "true"
}
