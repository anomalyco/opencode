import type { OpenCodeClient } from "@opencode/client/promise"

const MEDIA_REF = /^media:([0-9a-f]{64})$/

/** The blob hash in a `media:<hash>` ref, the only form the server sends stored media in. */
export function mediaHashFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined

  return MEDIA_REF.exec(uri)?.[1]
}

export type MediaCache = {
  peek(uri: string, mime?: string): string | undefined
  load(uri: string, mime?: string, signal?: AbortSignal): Promise<string | undefined>
  dispose(): void
}

// Object URLs stay valid until dispose. Rendered attachments, image previews and composer drafts keep the URL they
// were given without releasing it, so revoking one earlier would break an image that is still on screen.
export function createMediaCache(getApi: () => Pick<OpenCodeClient, "experimental">): MediaCache {
  const urls = new Map<string, string>()
  const inflight = new Map<string, Promise<string | undefined>>()
  let disposed = false

  const fetchObjectUrl = (hash: string, mime: string) =>
    getApi()
      .experimental.media.get({ hash })
      .then((bytes) => {
        if (disposed) return undefined

        const url =
          urls.get(hash) ??
          URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime || "application/octet-stream" }))

        urls.set(hash, url)

        return url
      })
      .finally(() => inflight.delete(hash))

  const read = (hash: string, mime: string) => {
    const pending = inflight.get(hash) ?? fetchObjectUrl(hash, mime)

    inflight.set(hash, pending)

    return pending
  }

  return {
    peek(uri) {
      const hash = mediaHashFromUri(uri)

      if (disposed || !hash) return undefined

      return urls.get(hash)
    },
    load(uri, mime = "application/octet-stream", signal) {
      const hash = mediaHashFromUri(uri)

      if (disposed || signal?.aborted) return Promise.resolve(undefined)

      if (!hash) return Promise.resolve(uri)
      const cached = urls.get(hash)

      if (cached) return Promise.resolve(cached)
      const pending = read(hash, mime)

      if (!signal) return pending

      return new Promise<string | undefined>((resolve, reject) => {
        const onAbort = () => resolve(undefined)

        signal.addEventListener("abort", onAbort, { once: true })
        pending.then(
          (url) => {
            signal.removeEventListener("abort", onAbort)
            resolve(signal.aborted ? undefined : url)
          },
          (error) => {
            signal.removeEventListener("abort", onAbort)

            if (signal.aborted) resolve(undefined)
            else reject(error)
          },
        )
      })
    },
    dispose() {
      disposed = true
      inflight.clear()
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}
