import type { Accessor } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createApiForServer } from "@/runtime/server/api"
import { uuid } from "@opencode/util/uuid"
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
      const api = createApiForServer({ server: sdk.http, fetch: progressFetch(report) })

      // One directory per upload keeps the original filename without collisions; the server
      // normalizes the separators and returns the resolved path.
      const written = await api.experimental.file.write(
        {
          location: { directory: location().directory },
          path: `${info.paths.tmp}/uploads/${uuid()}/${file.name}`,
          payload: file,
        },
        { signal },
      )

      return written.data.path
    },
  })
}

// fetch cannot report upload progress and Chromium only streams request bodies over HTTP/2, so
// the one request that needs both goes through XMLHttpRequest. The browser streams the File
// from disk; nothing is buffered in the renderer.
function progressFetch(report: (loaded: number) => void): typeof globalThis.fetch {
  const send = (input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal

      if (signal?.aborted) return reject(new DOMException("Upload aborted", "AbortError"))

      const xhr = new XMLHttpRequest()
      xhr.open(init?.method ?? "GET", input instanceof Request ? input.url : String(input))

      new Headers(init?.headers).forEach((value, name) => xhr.setRequestHeader(name, value))
      xhr.upload.addEventListener("progress", (event) => report(event.loaded))
      xhr.addEventListener("load", () => {
        const type = xhr.getResponseHeader("content-type")
        const empty = [204, 205, 304].includes(xhr.status)
        resolve(
          new Response(empty ? null : xhr.responseText, {
            status: xhr.status,
            headers: type ? { "content-type": type } : undefined,
          }),
        )
      })
      xhr.addEventListener("error", () => reject(new TypeError("Upload failed")))
      xhr.addEventListener("abort", () => reject(new DOMException("Upload aborted", "AbortError")))
      signal?.addEventListener("abort", () => xhr.abort(), { once: true })
      // SAFETY: only `experimental.file.write` uses this fetch, and its body is the File it was given.
      xhr.send((init?.body ?? null) as XMLHttpRequestBodyInit | null)
    })

  // Bun's fetch type carries preconnect; the browser never calls it.
  return Object.assign(send, { preconnect: () => {} })
}
