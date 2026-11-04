import { CliRenderEvents, resolveImageRenderProtocol } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  batch,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  useContext,
  type Component,
  type ParentProps,
} from "solid-js"
import { createMediaFiles } from "../component/media/file"
import type { MediaItem } from "../component/media/model"
import { useRichMedia } from "../config"

export type MediaPlayback = Readonly<{ time?: number; playing?: boolean }>
export type MediaViewerRequest = Readonly<{ items: readonly MediaItem[]; index: number } & MediaPlayback>
export type MediaPip = Readonly<{ item: MediaItem; time: number; playing: boolean }>
type MediaViews = Readonly<{
  viewer?: Component<{ request: MediaViewerRequest }>
  pip?: Component<{ pip: MediaPip }>
}>

/** Draw the PiP below the viewer, and both below dialogs (3000), so a dialog opened over them stays on top. */
export const MEDIA_PIP_Z_INDEX = 2000
export const MEDIA_VIEWER_Z_INDEX = 2500

// Each frame redraws every cell of a block thumbnail and re-encodes a Sixel one, so those play slower than Kitty.
const THUMBNAIL_FPS = { kitty: 15, sixel: 10, blocks: 12 }
const RESOLUTION_POLL_MS = 250
// Some terminals never report a pixel size; stop asking 10 seconds after startup, a resize, or enabling rich media.
const RESOLUTION_POLLS = 40

const [views, setViews] = createSignal<MediaViews>({})

/**
 * Sets the components `MediaHost` renders, one per viewer request or PiP. Call it once at module load. Returns a
 * function that restores the previous views.
 */
export function registerMediaViews(next: MediaViews) {
  const previous = views()
  setViews({ ...previous, ...next })
  return () => setViews(previous)
}

const MediaContext = createContext<ReturnType<typeof init>>()

function init(directory: string) {
  const renderer = useRenderer()
  const richMedia = useRichMedia()
  const [viewer, setViewer] = createSignal<MediaViewerRequest>()
  const [activeTile, setActiveTile] = createSignal<string>()
  const [pip, setPip] = createSignal<MediaPip>()
  const read = () => {
    const resolution = renderer.resolution
    const protocol = resolveImageRenderProtocol("auto", renderer.capabilities, resolution !== null)
    if (!resolution || resolution.width <= 0 || resolution.height <= 0 || renderer.width <= 0 || renderer.height <= 0)
      return { protocol, cellAspect: 2, cellWidth: undefined }
    const cellWidth = resolution.width / renderer.width
    return { protocol, cellAspect: resolution.height / renderer.height / cellWidth, cellWidth }
  }
  const [terminal, setTerminal] = createSignal(read(), {
    equals: (a, b) => a.protocol === b.protocol && a.cellAspect === b.cellAspect && a.cellWidth === b.cellWidth,
  })
  // OpenTUI learns the pixel resolution after startup and again after every resize, without an event of its own.
  let poll: ReturnType<typeof setInterval> | undefined
  let polls = 0
  const update = () => {
    setTerminal(read())
    if (!renderer.resolution && richMedia() && polls++ < RESOLUTION_POLLS) {
      poll ??= setInterval(update, RESOLUTION_POLL_MS)
      return
    }
    clearInterval(poll)
    poll = undefined
  }
  const restart = () => {
    polls = 0
    update()
  }
  restart()
  renderer.on(CliRenderEvents.CAPABILITIES, restart)
  renderer.on(CliRenderEvents.RESIZE, restart)
  onCleanup(() => {
    renderer.off(CliRenderEvents.CAPABILITIES, restart)
    renderer.off(CliRenderEvents.RESIZE, restart)
    clearInterval(poll)
  })

  createEffect(
    on(
      richMedia,
      (enabled) => {
        restart()
        if (enabled) return
        batch(() => {
          setViewer(undefined)
          setPip(undefined)
          setActiveTile(undefined)
        })
      },
      { defer: true },
    ),
  )

  return {
    files: createMediaFiles(directory),
    capabilities: () => ({ protocol: terminal().protocol, thumbnailFps: THUMBNAIL_FPS[terminal().protocol] }),
    /** How many times taller than wide a cell is; twice as tall without a known pixel resolution. */
    cellAspect: () => terminal().cellAspect,
    /** Terminal pixels across a cell. Blocks draw two per cell; a pixel protocol without a resolution guesses 10. */
    cellPixels: () => (terminal().protocol === "blocks" ? 2 : (terminal().cellWidth ?? 10)),
    viewer,
    /** Opens the viewer over a gallery at `index`; inline tiles stop playing. */
    openViewer(items: readonly MediaItem[], index: number, playback?: MediaPlayback) {
      if (items.length === 0) return
      setActiveTile(undefined)
      setViewer({ items, index: Math.max(0, Math.min(items.length - 1, index)), ...playback })
    },
    closeViewer: () => setViewer(undefined),
    /** The key of the one inline tile allowed to play. */
    activeTile,
    setActiveTile,
    pip,
    openPip(item: MediaItem, playback: MediaPlayback = {}) {
      setPip({ item, time: playback.time ?? 0, playing: playback.playing ?? true })
    },
    closePip: () => setPip(undefined),
  }
}

export type MediaContext = ReturnType<typeof init>

/** Media coordination for the app. `directory` holds video files copied out of refs and data URIs for playback. */
export function MediaProvider(props: ParentProps<{ directory: string }>) {
  return <MediaContext.Provider value={init(props.directory)}>{props.children}</MediaContext.Provider>
}

export function useMedia() {
  const value = useContext(MediaContext)
  if (!value) throw new Error("MediaProvider is missing")
  return value
}

/** Renders the registered viewer and PiP. Mount it once, inside the dialog provider and above the routes. */
export function MediaHost() {
  const media = useMedia()
  return (
    <>
      <Show when={views().pip} keyed>
        {(View) => (
          <Show when={media.pip()} keyed>
            {(pip) => <View pip={pip} />}
          </Show>
        )}
      </Show>
      <Show when={views().viewer} keyed>
        {(View) => (
          <Show when={media.viewer()} keyed>
            {(request) => <View request={request} />}
          </Show>
        )}
      </Show>
    </>
  )
}
