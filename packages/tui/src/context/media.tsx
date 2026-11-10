import {
  CliRenderEvents,
  resolveImageRenderProtocol,
  ScrollBoxRenderable,
  type Renderable,
  type TimerHandle,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createContext, createEffect, createSignal, on, onCleanup, Show, useContext, type JSX } from "solid-js"
import { createMediaFiles } from "../component/media/file"
import type { MediaItem } from "../component/media/model"
import { useRichMedia } from "../config"

type MediaSound = Readonly<{ muted?: boolean; volume?: number; loop?: boolean }>
export type MediaPlayback = Readonly<{ time?: number; playing?: boolean }> & MediaSound
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
// A tile that drops out keeps its player this long: opening one and seeking it to the poster blocks for about 70 ms
// on a 1080p clip, so a tile scrolled out and back would stall each time.
const POSTER_GRACE_MS = 2_000

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
  const [shown, setShown] = createSignal<ReadonlySet<string>>(new Set(), { equals: sameKeys })
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set(), { equals: sameKeys })
  const [durations, setDurations] = createSignal<ReadonlyMap<string, number>>(new Map())
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
  let poll: TimerHandle | undefined
  let polls = 0
  const stop = () => {
    if (poll) renderer.clock.clearTimeout(poll)
    poll = undefined
  }
  const update = () => {
    stop()
    setTerminal(read())
    if (renderer.resolution || !richMedia() || polls++ >= 40) return
    poll = renderer.clock.setTimeout(update, 250)
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
    stop()
  })

  // Kitty frames pass through temporary files instead of base64 in the output. OpenTUI keeps sending them inline
  // until a probe shows the terminal reads the files, and always in a remote session or a multiplexer.
  const transport = renderer.kittyImageTransport
  createEffect(() => (renderer.kittyImageTransport = richMedia() ? "file" : transport))
  onCleanup(() => (renderer.kittyImageTransport = transport))

  // A tile moves when a scroll box around it scrolls or resizes, the terminal resizes, or tiles come and go, so the
  // frame after one of those measures the tracked tiles again.
  const tracked = new Map<string, Renderable>()
  let boxes = new Set<ScrollBoxRenderable>()
  // The tiles keeping a player, each with when it dropped out of the ranking; Infinity while it ranks.
  let players = new Map<string, number>()
  // The tiles a hidden ancestor hid at the last placement.
  let hidden = new Set<string>()
  let measuring = false
  let expiry: TimerHandle | undefined
  const invalidate = () => {
    if (measuring) return
    measuring = true
    renderer.once(CliRenderEvents.FRAME, place)
  }
  const watch = (box: ScrollBoxRenderable, method: "on" | "off") => {
    box.verticalScrollBar[method]("change", invalidate)
    box.horizontalScrollBar[method]("change", invalidate)
    box.viewport[method]("resize", invalidate)
    box.content[method]("resize", invalidate)
  }
  // Hiding or showing an ancestor moves nothing and fires no event, so each frame looks for a tile with a player, or
  // one hidden at the last placement, whose ancestors changed. Without such a tile it does nothing.
  const check = () => {
    if (measuring || (players.size === 0 && hidden.size === 0)) return
    const changed = (key: string) => {
      const element = tracked.get(key)
      return element !== undefined && underHidden(element) !== hidden.has(key)
    }
    if ([...players.keys()].some(changed) || [...hidden].some(changed)) place()
  }
  const place = () => {
    measuring = false
    const now = renderer.clock.now()
    const seen = new Set<ScrollBoxRenderable>()
    const tiles = [...tracked].map(([key, element]) => ({ key, ...measure(element, renderer, seen) }))
    const near = tiles.filter((tile) => tile.near)
    hidden = new Set(tiles.filter((tile) => tile.hidden).map((tile) => tile.key))
    // Fully visible tiles rank first, then those showing more of themselves. Tiles under the viewer do not rank.
    const ranked = viewer() ? [] : near.toSorted((a, b) => b.share - a.share).slice(0, POSTER_LIMIT)
    const kept = [...players]
      .map(([key, since]) => [key, Math.min(since, now)] as const)
      .filter(
        ([key, since]) => tracked.has(key) && now - since < POSTER_GRACE_MS && !ranked.some((tile) => tile.key === key),
      )
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, POSTER_LIMIT)
    players = new Map([...ranked.map((tile) => [tile.key, Infinity] as const), ...kept])
    setShown(new Set(near.map((tile) => tile.key)))
    setOpen(new Set(players.keys()))

    for (const box of boxes) if (!seen.has(box)) watch(box, "off")
    for (const box of seen) if (!boxes.has(box)) watch(box, "on")
    boxes = seen
    if (expiry) renderer.clock.clearTimeout(expiry)
    expiry = undefined
    if (kept.length === 0) return
    expiry = renderer.clock.setTimeout(
      () => {
        expiry = undefined
        invalidate()
        renderer.requestRender()
      },
      Math.min(...kept.map(([, since]) => since + POSTER_GRACE_MS - now)),
    )
  }
  createEffect(
    on(
      () => viewer() !== undefined,
      () => tracked.size > 0 && invalidate(),
      { defer: true },
    ),
  )
  onCleanup(() => {
    renderer.off(CliRenderEvents.FRAME, place)
    renderer.off(CliRenderEvents.FRAME, check)
    renderer.off(CliRenderEvents.RESIZE, invalidate)
    for (const box of boxes) watch(box, "off")
    if (expiry) renderer.clock.clearTimeout(expiry)
  })

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
    /** Follows where an inline video tile is, until the returned function stops it. */
    trackPoster(key: string, element: Renderable) {
      if (tracked.size === 0) {
        renderer.on(CliRenderEvents.RESIZE, invalidate)
        renderer.on(CliRenderEvents.FRAME, check)
      }
      tracked.set(key, element)
      invalidate()
      return () => {
        tracked.delete(key)
        if (tracked.size === 0) {
          renderer.off(CliRenderEvents.RESIZE, invalidate)
          renderer.off(CliRenderEvents.FRAME, check)
        }
        invalidate()
      }
    },
    /** Whether the tile is on screen, or within half a scroll box of it, so it shows before it scrolls in. */
    posterShown: (key: string) => shown().has(key),
    /**
     * Whether the tile keeps a player open for its poster frame: one of the POSTER_LIMIT tiles showing the most of
     * themselves, or one of up to POSTER_LIMIT more that dropped out of those less than POSTER_GRACE_MS ago, so
     * scrolling back and forth opens no player again. Under the viewer, tiles only keep the players they had.
     */
    posterOpen: (key: string) => open().has(key),
    /** The duration of a video some player has opened, so a filmstrip card can show it without a decoder of its own. */
    duration: (item: MediaItem) => durations().get(item.path ?? item.uri),
    noteDuration(item: MediaItem, seconds: number) {
      const key = item.path ?? item.uri
      if (durations().get(key) !== seconds) setDurations((value) => new Map(value).set(key, seconds))
    },
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

/**
 * The share of the tile inside the screen and every scroll box around it, whether it is within half a scroll box of
 * them, and whether a hidden ancestor hides it. Adds those scroll boxes to `boxes`.
 */
function measure(element: Renderable, screen: { width: number; height: number }, boxes: Set<ScrollBoxRenderable>) {
  if (underHidden(element)) return { share: 0, near: false, hidden: true }
  const clips = [{ x: 0, y: 0, width: screen.width, height: screen.height }]
  for (let node: Renderable | null = element.parent; node; node = node.parent) {
    if (!(node instanceof ScrollBoxRenderable)) continue
    boxes.add(node)
    const viewport = node.viewport
    clips.push({ x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height })
  }
  const rect = { x: element.x, y: element.y, width: element.width, height: element.height }
  const area = (grow: number) => {
    const left = Math.max(rect.x, ...clips.map((clip) => clip.x - clip.width * grow))
    const top = Math.max(rect.y, ...clips.map((clip) => clip.y - clip.height * grow))
    const right = Math.min(rect.x + rect.width, ...clips.map((clip) => clip.x + clip.width * (1 + grow)))
    const bottom = Math.min(rect.y + rect.height, ...clips.map((clip) => clip.y + clip.height * (1 + grow)))
    return Math.max(0, right - left) * Math.max(0, bottom - top)
  }
  return { share: area(0) / (rect.width * rect.height || 1), near: area(0.5) > 0, hidden: false }
}

function underHidden(element: Renderable) {
  for (let node: Renderable | null = element; node; node = node.parent) if (!node.visible) return true
  return false
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((key) => b.has(key))
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
