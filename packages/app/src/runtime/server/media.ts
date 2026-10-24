import type { OpenCodeClient } from "@opencode/client/promise"

export const MEDIA_URI_PREFIX = "/api/media/"
export const DEFAULT_MAX_MEDIA_CACHE_ENTRIES = 128

export function mediaHashFromUri(uri: string | undefined): string | undefined {
  if (!uri?.startsWith(MEDIA_URI_PREFIX)) return undefined
  const hash = uri.slice(MEDIA_URI_PREFIX.length)
  return /^[0-9a-f]{64}$/.test(hash) ? hash : undefined
}

export type MediaCache = {
  peek(uri: string, mime?: string): string | undefined
  load(uri: string, mime?: string, signal?: AbortSignal): Promise<string | undefined>
  dispose(): void
}

export function createMediaCache(
  getApi: () => Pick<OpenCodeClient, "media">,
  options?: { readonly maxEntries?: number },
): MediaCache {
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_MAX_MEDIA_CACHE_ENTRIES)
  const urls = new Map<string, string>()
  const inflight = new Map<string, Promise<string | undefined>>()
  let disposed = false

  const touch = (hash: string, url: string) => {
    if (urls.has(hash)) urls.delete(hash)
    urls.set(hash, url)
    while (urls.size > maxEntries) {
      const oldest = urls.keys().next().value
      if (!oldest) break
      const evicted = urls.get(oldest)
      urls.delete(oldest)
      if (evicted) URL.revokeObjectURL(evicted)
    }
  }

  const fetchObjectUrl = (hash: string, mime: string) =>
    getApi()
      .media.get({ hash })
      .then((bytes) => {
        if (disposed) return undefined
        const existing = urls.get(hash)
        if (existing) {
          touch(hash, existing)
          return existing
        }
        const blob = new Blob([new Uint8Array(bytes)], { type: mime || "application/octet-stream" })
        const url = URL.createObjectURL(blob)
        touch(hash, url)
        return url
      })
      .finally(() => {
        inflight.delete(hash)
      })

  return {
    peek(uri) {
      if (disposed) return undefined
      const hash = mediaHashFromUri(uri)
      if (!hash) return undefined
      const url = urls.get(hash)
      if (url) touch(hash, url)
      return url
    },
    load(uri, mime = "application/octet-stream", signal) {
      if (disposed || signal?.aborted) return Promise.resolve(undefined)
      const hash = mediaHashFromUri(uri)
      if (!hash) return Promise.resolve(uri)
      const cached = urls.get(hash)
      if (cached) {
        touch(hash, cached)
        return Promise.resolve(cached)
      }
      let pending = inflight.get(hash)
      if (!pending) {
        pending = fetchObjectUrl(hash, mime)
        inflight.set(hash, pending)
      }
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
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}
