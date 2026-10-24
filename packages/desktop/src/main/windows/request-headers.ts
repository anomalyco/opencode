import type { BeforeSendResponse, OnBeforeSendHeadersListenerDetails, WebFrameMain } from "electron"
import { SidecarCredentials } from "../service/sidecar-credentials"
import { hasHeader, upsertHeader } from "./headers"
import { isRendererUrl } from "./scheme"

export function rendererRequestHeaders(authorize: (url: string) => string | undefined) {
  return (
    details: Pick<OnBeforeSendHeadersListenerDetails, "url" | "requestHeaders"> & {
      frame?: Pick<WebFrameMain, "parent" | "url"> | null
    },
    callback: (response: BeforeSendResponse) => void,
  ) => {
    try {
      const frame = details.frame
      const renderer = !!frame && frame.parent === null && isRendererUrl(frame.url)
      const configured = renderer && authorize(details.url)

      const authorization =
        configured ||
        (renderer &&
          !hasHeader(details.requestHeaders, "Authorization") &&
          SidecarCredentials.authorization(SidecarCredentials.get(), details.url))

      if (authorization) upsertHeader(details.requestHeaders, "Authorization", authorization)
    } catch {
      // A credential failure must not leave Chromium waiting for its callback.
    } finally {
      callback({ requestHeaders: details.requestHeaders })
    }
  }
}
