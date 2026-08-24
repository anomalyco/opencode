import { ServerConnection } from "@/runtime/server/registry"
import type { Platform } from "@/runtime/platform/platform"

export function directoryPickerKind(platform: Platform["platform"], server: ServerConnection.Any) {
  if (platform === "desktop" && ServerConnection.local(server)) return "native" as const
  return "server" as const
}
