import { mediaHashFromUri, type OpenCodeClient } from "@opencode/client"

export type MediaCache = ReturnType<typeof createMediaCache>

/**
 * Bytes for `media:<hash>` refs, read from the server the first time something shows or restores them. A hash names
 * its bytes, so entries stay valid across reconnects.
 */
export function createMediaCache(
  api: () => { experimental: { media: Pick<OpenCodeClient["experimental"]["media"], "get"> } },
) {
  const bytes = new Map<string, Uint8Array>()
  const inflight = new Map<string, Promise<Uint8Array>>()

  return {
    peek: (uri: string) => {
      const hash = mediaHashFromUri(uri)
      return hash ? bytes.get(hash) : undefined
    },
    read: (uri: string) => {
      const hash = mediaHashFromUri(uri)
      if (!hash) return Promise.reject(new Error(`Not a media ref: ${uri}`))
      const cached = bytes.get(hash)
      if (cached) return Promise.resolve(cached)
      const pending =
        inflight.get(hash) ??
        api()
          .experimental.media.get({ hash })
          .then((result) => {
            bytes.set(hash, result)
            return result
          })
          .finally(() => inflight.delete(hash))
      inflight.set(hash, pending)
      return pending
    },
  }
}

/** The server answered that the blob is gone (404), as opposed to a failure where it may still exist. */
export function isMissingMedia(error: unknown) {
  return error instanceof Error && error.name === "FileNotFoundError"
}
