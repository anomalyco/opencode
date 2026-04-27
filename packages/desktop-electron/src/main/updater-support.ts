export type UpdaterSupportInput = {
  isPackaged: boolean
  channel: "dev" | "beta" | "prod"
  platform: NodeJS.Platform
  appImage: string | undefined
}

export function isUpdaterEnabled(input: UpdaterSupportInput) {
  if (!input.isPackaged) return false
  if (input.channel === "dev") return false
  if (input.platform !== "linux") return true
  return Boolean(input.appImage)
}
