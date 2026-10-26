import { createContext, useContext } from "solid-js"
import type { createExtensionAttachment } from "./host-apis"

// Apart from `host-apis.tsx`, so session code such as the side panels reads the attachment without loading the HostApis.
const AttachmentContext = createContext<ReturnType<typeof createExtensionAttachment>>()

export function useExtensionAttachment() {
  const value = useContext(AttachmentContext)

  if (!value) throw new Error("Extension attachment is unavailable")

  return value
}

export const ExtensionAttachmentProvider = AttachmentContext.Provider
