import type { Accessor } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { authTokenFromCredentials } from "@/runtime/server/api"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerControls } from "../adapter"

// Where a prompt is headed: the model that reads it and the server that runs its tools.
export type AttachmentDestination = {
  /** Input modalities the selected model reads natively. */
  input: { image: boolean; pdf: boolean }
  /** The server shares the client's filesystem, so an attachment's source path resolves as-is. */
  local: boolean
  /** Streams a file into the server's temporary directory and returns its absolute path there. */
  upload: (file: File, report: (loaded: number) => void, signal: AbortSignal) => Promise<string>
}

export function useAttachmentDestination(controls: Accessor<ComposerControls>) {
  const server = useServer()
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  return (): AttachmentDestination => ({
    input: controls().model.selection.current()?.capabilities.input ?? { image: false, pdf: false },
    local: server.isLocal,
    upload: async (file, report, signal) => {
      const info = await sdk.api.server.info({ signal })
      // One directory per upload keeps the original filename without collisions; the server
      // normalizes the separators and returns the resolved path.
      const url = new URL("/api/experimental/fs/write", server.conn.http.url)
      url.searchParams.set("location[directory]", location().directory)
      url.searchParams.set("path", `${info.paths.tmp}/uploads/${crypto.randomUUID()}/${file.name}`)
      return write(url, file, server.conn.http.password, report, signal)
    },
  })
}

// fetch cannot report upload progress and Chromium only streams request bodies over HTTP/2, so
// the one request that needs both goes through XMLHttpRequest. The browser streams the File
// from disk; nothing is buffered in the renderer.
function write(url: URL, file: File, password: string | undefined, report: (loaded: number) => void, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.responseType = "json"
    xhr.setRequestHeader("content-type", "application/octet-stream")
    if (password) xhr.setRequestHeader("authorization", `Basic ${authTokenFromCredentials({ password })}`)
    xhr.upload.addEventListener("progress", (event) => report(event.loaded))
    xhr.addEventListener("load", () => {
      if (xhr.status !== 200) return reject(new Error(`Upload failed with status ${xhr.status}`))
      resolve((xhr.response as { data: { path: string } }).data.path)
    })
    xhr.addEventListener("error", () => reject(new Error("Upload failed")))
    xhr.addEventListener("abort", () => reject(new DOMException("Upload aborted", "AbortError")))
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}
