import type { ServerConnection } from "@/runtime/server/registry"

export type DesignProjectTarget = {
  key: string
  server: ServerConnection.Any
  directory: string
  label: string
  serverLabel?: string
}
