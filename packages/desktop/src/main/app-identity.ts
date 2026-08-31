export const UNPACKAGED_APP_ID = "ai.opencode.desktop.dev.unpacked"

export function resolveAppUserModelId(appId: string, packaged: boolean) {
  if (packaged) return appId
  return UNPACKAGED_APP_ID
}
