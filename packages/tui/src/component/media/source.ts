import { createEffect, createMemo, createSignal, on, onCleanup, useContext, type Accessor } from "solid-js"
import { ClientContext } from "../../context/client"
import { useMedia } from "../../context/media"
import { useTuiTerminalEnvironment } from "../../context/runtime"
import { resolveImageSource, resolveVideoFile, type MediaSources } from "./file"
import type { MediaItem } from "./model"

/** An `<image>` source for the item. `failed` covers a failed read and, through `onError`, a failed decode. */
export function createImageSource(item: Accessor<MediaItem>) {
  const [state, setState] = createResolved(item, resolveImageSource)
  return {
    source: () => state().value,
    failed: () => state().failed,
    onError: () => setState({ failed: true }),
  }
}

/** A local file `<video>` can open for the item. `failed` means no source could supply the bytes. */
export function createVideoFile(item: Accessor<MediaItem>) {
  const [state] = createResolved(item, resolveVideoFile)
  return () => ({ path: state().value, failed: state().failed })
}

function createResolved<T>(item: Accessor<MediaItem>, resolve: (item: MediaItem, sources: MediaSources) => Promise<T>) {
  const media = useMedia()
  const client = useContext(ClientContext)
  const environment = useTuiTerminalEnvironment()
  const [state, setState] = createSignal<{ value?: T; failed: boolean }>({ failed: false })
  const source = createMemo(item, undefined, {
    equals: (a, b) =>
      a.uri === b.uri &&
      a.path === b.path &&
      a.location?.directory === b.location?.directory &&
      a.location?.workspaceID === b.location?.workspaceID,
  })

  createEffect(
    on(source, (current) => {
      setState({ failed: false })
      let active = true
      onCleanup(() => (active = false))
      resolve(current, {
        files: media.files,
        localServer: environment.localServer === true,
        media: client?.media,
        readFile: client ? (input) => client.api.file.read(input) : undefined,
      }).then(
        (value) => active && setState({ value, failed: false }),
        () => active && setState({ failed: true }),
      )
    }),
  )

  return [state, setState] as const
}
