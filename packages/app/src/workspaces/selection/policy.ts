import { ServerConnection } from "@/runtime/server/registry"
import type { Platform } from "@/runtime/platform/platform"

export function directoryPickerKind(platform: Platform["platform"], server: ServerConnection.Any, ownUrl?: string) {
  if (platform === "desktop" && ServerConnection.local(server, ownUrl)) return "native" as const

  return "server" as const
}
