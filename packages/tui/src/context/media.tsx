import {
  CliRenderEvents,
  resolveImageRenderProtocol,
  ScrollBoxRenderable,
  type CliRenderer,
  type Renderable,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createContext, createEffect, createSignal, on, onCleanup, Show, useContext, type JSX } from "solid-js"
import { createMediaFiles } from "../component/media/file"
import type { MediaItem } from "../component/media/model"
import { useRichMedia } from "../config"

export type MediaPlayback = Readonly<{
  time?: number
  playing?: boolean
  muted?: boolean
  volume?: number
  loop?: boolean
}>
export type MediaViewerRequest = Readonly<{ items: readonly MediaItem[]; index: number } & MediaPlayback>
export type MediaPipRequest = Readonly<{ item: MediaItem } & MediaPlayback>
type MediaViews = Readonly<{
  viewer?: (props: { request: MediaViewerRequest }) => JSX.Element
  pip?: (props: { pip: MediaPipRequest }) => JSX.Element
}>

/** The PiP draws below the viewer, and both below dialogs (3000). */
export const MEDIA_PIP_Z_INDEX = 2000
export const MEDIA_VIEWER_Z_INDEX = 2500

// Each frame redraws every cell of a block thumbnail and re-encodes a Sixel one, so those play slower than Kitty.
const THUMBNAIL_FPS = { kitty: 15, sixel: 10, blocks: 12 }
// Each poster player holds a decoder of about 86 MB and a dozen threads.
const POSTER_LIMIT = 4

let views: MediaViews = {}

/** Sets the components `MediaHost` renders. */
export function registerMediaViews(next: MediaViews) {
  views = { ...views, ...next }
}

const MediaContext = createContext<ReturnType<typeof init>>()

function init(directory: string) {
  const renderer = useRenderer()
  const richMedia = useRichMedia()
  const [viewer, setViewer] = createSignal<MediaViewerRequest>()
  const [activeTile, setActiveTile] = createSignal<string>()
  const [pip, setPip] = createSignal<MediaPipRequest>()
  // The inline video tiles on screen, in the order they came on screen.
  const [posters, setPosters] = createSignal<readonly string[]>([])
  const read = () => {
    const resolution = renderer.resolution
    const protocol = resolveImageRenderProtocol("auto", renderer.capabilities, resolution !== null)
    const cellWidth =
      resolution && resolution.width > 0 && resolution.height > 0 ? resolution.width / renderer.width : 0
    return { protocol, cellWidth, cellAspect: cellWidth ? resolution!.height / renderer.height / cellWidth : 2 }
  }
  const [terminal, setTerminal] = createSignal(read(), {
    equals: (a, b) => a.protocol === b.protocol && a.cellAspect === b.cellAspect && a.cellWidth === b.cellWidth,
  })
  // OpenTUI learns the pixel resolution after startup and after every resize, without an event. Some terminals never
  // report it, so stop asking 10 seconds after startup, a resize, or enabling rich media.
  let poll: ReturnType<typeof setInterval> | undefined
  let polls = 0
  const update = () => {
    setTerminal(read())
    if (renderer.resolution || !richMedia() || polls++ >= 40) {
      clearInterval(poll)
      poll = undefined
      return
    }
    poll ??= setInterval(update, 250)
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

  // Kitty frames pass through temporary files instead of base64 in the output. OpenTUI keeps sending them inline
  // until a probe shows the terminal reads the files, and always in a remote session or a multiplexer.
  const transport = renderer.kittyImageTransport
  createEffect(() => (renderer.kittyImageTransport = richMedia() ? "file" : transport))
  onCleanup(() => (renderer.kittyImageTransport = transport))

  // Scrolling or a layout change moves a tile without an event, so each frame checks where the tracked tiles are.
  const tracked = new Map<string, () => Renderable | undefined>()
  const place = () => {
    const shown = [...tracked.keys()].filter((key) => {
      const node = tracked.get(key)!()
      return node !== undefined && onScreen(node, renderer)
    })
    // Tiles that stay on screen keep their place; those that came on screen go last.
    const next = [...posters().filter((key) => shown.includes(key)), ...shown.filter((key) => !posters().includes(key))]
    if (next.length !== posters().length || next.some((key, index) => key !== posters()[index])) setPosters(next)
  }
  onCleanup(() => renderer.off(CliRenderEvents.FRAME, place))

  createEffect(
    on(
      richMedia,
      (enabled) => {
        restart()
        if (enabled) return
        setViewer(undefined)
        setPip(undefined)
        setActiveTile(undefined)
      },
      { defer: true },
    ),
  )

  return {
    files: createMediaFiles(directory),
    protocol: () => terminal().protocol,
    thumbnailFps: () => THUMBNAIL_FPS[terminal().protocol],
    /** How many times taller than wide a cell is; twice as tall without a known pixel resolution. */
    cellAspect: () => terminal().cellAspect,
    /** Terminal pixels across a cell. Blocks draw two per cell; a pixel protocol without a resolution guesses 10. */
    cellPixels: () => (terminal().protocol === "blocks" ? 2 : terminal().cellWidth || 10),
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
    /** Follows whether an inline video tile is on screen after each frame, until the returned function stops it. */
    trackPoster(key: string, element: () => Renderable | undefined) {
      if (tracked.size === 0) renderer.on(CliRenderEvents.FRAME, place)
      tracked.set(key, element)
      return () => {
        tracked.delete(key)
        if (tracked.size === 0) renderer.off(CliRenderEvents.FRAME, place)
        setPosters((keys) => keys.filter((item) => item !== key))
      }
    },
    /** Whether any of the tile is inside the screen and every scroll box around it. */
    posterShown: (key: string) => posters().includes(key),
    /** Whether the tile is among the last few to come on screen, which keep a player open for their poster frame. */
    posterOpen: (key: string) => posters().slice(-POSTER_LIMIT).includes(key),
    pip,
    openPip: (item: MediaItem, playback?: MediaPlayback) => setPip({ item, ...playback }),
    closePip: () => setPip(undefined),
  }
}

/** Media coordination for the app. `directory` holds video files copied out of refs and data URIs for playback. */
export function MediaProvider(props: { directory: string; children: JSX.Element }) {
  return <MediaContext.Provider value={init(props.directory)}>{props.children}</MediaContext.Provider>
}

export function useMedia() {
  const value = useContext(MediaContext)
  if (!value) throw new Error("MediaProvider is missing")
  return value
}

function onScreen(element: Renderable, renderer: CliRenderer) {
  const clips = [{ x: 0, y: 0, width: renderer.width, height: renderer.height }]
  for (let node: Renderable | null = element; node; node = node.parent) {
    if (!node.visible) return false
    if (node !== element && node instanceof ScrollBoxRenderable) clips.push(node.viewport)
  }
  return clips.every(
    (clip) =>
      element.x < clip.x + clip.width &&
      clip.x < element.x + element.width &&
      element.y < clip.y + clip.height &&
      clip.y < element.y + element.height,
  )
}

/** Renders the registered viewer and PiP. Mount it once, inside the dialog provider and above the routes. */
export function MediaHost() {
  const media = useMedia()
  return (
    <>
      <Show when={media.pip()} keyed>
        {(pip) => views.pip?.({ pip })}
      </Show>
      <Show when={media.viewer()} keyed>
        {(request) => views.viewer?.({ request })}
      </Show>
    </>
  )
}
