import { mediaHashFromUri } from "@opencode/client"
import { createEffect, createSignal, on, onCleanup, useContext, type Accessor } from "solid-js"
import { ClientContext } from "../context/client"

/**
 * An `<image>` source for a URI that may be a `media:<hash>` ref. A ref reads its bytes from the server once something
 * shows it, so images nobody looks at fetch nothing; other URIs pass through. `failed` covers a failed read and, through
 * `onError`, a failed decode, until the URI changes.
 */
export function createMediaSource(uri: Accessor<string>) {
  // Optional: image dialogs also render outside a connected client, where only plain URIs can load.
  const media = useContext(ClientContext)?.media
  const [bytes, setBytes] = createSignal(media?.peek(uri()))
  const [failed, setFailed] = createSignal(false)

  createEffect(
    on(uri, (current) => {
      setFailed(false)
      const cached = media?.peek(current)
      setBytes(cached)
      if (cached || !mediaHashFromUri(current)) return
      if (!media) return setFailed(true)
      let active = true
      onCleanup(() => {
        active = false
      })
      media.read(current).then(
        (result) => {
          if (active) setBytes(result)
        },
        () => {
          if (active) setFailed(true)
        },
      )
    }),
  )

  return {
    source: (): string | Uint8Array | undefined => (mediaHashFromUri(uri()) ? bytes() : uri()),
    failed,
    onError: () => setFailed(true),
  }
}
