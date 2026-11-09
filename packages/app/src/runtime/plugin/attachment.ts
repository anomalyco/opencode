import { createContext, useContext } from "solid-js"
import type { createPluginAttachment } from "./host-apis"

// Apart from `host-apis.tsx`, so session code such as the side panels reads the attachment without loading the HostApis.
const AttachmentContext = createContext<ReturnType<typeof createPluginAttachment>>()

export function usePluginAttachment() {
  const value = useContext(AttachmentContext)

  if (!value) throw new Error("Plugin attachment is unavailable")

  return value
}

export const PluginAttachmentProvider = AttachmentContext.Provider
