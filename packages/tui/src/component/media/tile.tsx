import type { BoxRenderable, CliRenderer, MouseEvent, TimerHandle, VideoRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, createUniqueId, Match, onCleanup, Show, Switch } from "solid-js"
import { useMedia } from "../../context/media"
import { useTheme } from "../../context/theme"
import { isPlayableVideo, type MediaItem } from "./model"
import { createImageSource, createVideoFile } from "./source"

/** A hovered video tile plays once the pointer rests this long, so sweeping across tiles opens no players. */
const HOVER_REST_MS = 300

/**
 * A thumbnail for an image or video. A video shows a poster frame while the media context lets it keep a player, and
 * plays silently in a loop as the one active tile once the pointer rests on it; leaving it pauses and returns to the
 * poster. A click calls `onOpen`. A video over the limit shows only its name, keeping no decoder open.
 */
export function MediaTile(props: { item: MediaItem; width: number; height: number; onOpen?: () => void }) {
  const media = useMedia()
  const theme = useTheme()
  const renderer = useRenderer()
  const key = createUniqueId()
  const click = createMediaClick(() => props.onOpen?.())
  const poster = () => isPlayableVideo(props.item)
  const active = () => media.activeTile() === key
  let box: BoxRenderable | undefined
  let hovered = false
  let rest: TimerHandle | undefined
  const release = () => {
    if (rest) renderer.clock.clearTimeout(rest)
    rest = undefined
    if (active()) media.setActiveTile(undefined)
  }
  const arm = () => {
    release()
    rest = renderer.clock.setTimeout(() => {
      rest = undefined
      media.setActiveTile(key)
    }, HOVER_REST_MS)
  }

  createEffect(() => {
    if (poster()) onCleanup(media.trackPoster(key, box!))
  })
  onCleanup(release)

  return (
    <box
      ref={(element: BoxRenderable) => (box = element)}
      width={props.width}
      height={props.height}
      flexShrink={0}
      position="relative"
      backgroundColor={theme.background.raised.base}
      onMouseOver={() => {
        hovered = true
        if (poster() && !active() && !rest) arm()
      }}
      onMouseMove={() => rest && arm()}
      onMouseOut={() => {
        hovered = false
        // Moving between the tile's own children fires out and then over; only leaving the tile releases it.
        queueMicrotask(() => !hovered && release())
      }}
      {...click}
    >
      <Switch fallback={<TileLabel item={props.item} />}>
        <Match when={props.item.kind === "image"}>
          <TileImage item={props.item} />
        </Match>
        <Match when={poster() && (active() || media.posterOpen(key))}>
          <TileVideo item={props.item} active={active()} />
        </Match>
        <Match when={isPlayableVideo(props.item) && media.posterShown(key)}>
          <TileLabel item={props.item} text={`▶ ${props.item.name ?? "video"}`} />
        </Match>
        {/* Further off screen, a video tile draws nothing. */}
        <Match when={isPlayableVideo(props.item)}>{null}</Match>
      </Switch>
    </box>
  )
}

function TileLabel(props: { item: MediaItem; text?: string }) {
  const theme = useTheme()
  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center">
      <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
        {props.text ?? (props.item.name ? `${props.item.kind} · ${props.item.name}` : props.item.kind)}
      </text>
    </box>
  )
}

export function TileImage(props: { item: MediaItem }) {
  const source = createImageSource(() => props.item)
  return (
    <Show when={!source.failed()} fallback={<TileLabel item={props.item} />}>
      <image source={source.source()} fit="cover" protocol="auto" width="100%" height="100%" onError={source.onError} />
    </Show>
  )
}

function TileVideo(props: { item: MediaItem; active: boolean }) {
  const media = useMedia()
  const theme = useTheme()
  const file = createVideoFile(() => props.item)
  const [video, setVideo] = createSignal<VideoRenderable>()
  const [duration, setDuration] = createSignal<number>()
  // The file that failed to open, so a new file for a changed item gets its own try. While loading, the tile is empty.
  const [broken, setBroken] = createSignal<string>()

  // Seeking before the player is ready does nothing; the duration arrives with readiness and seeks it to the poster.
  createEffect(() => {
    const player = video()
    if (!player) return
    if (props.active) return player.play()
    const poster = posterTime(duration() ?? 0)
    if (player.paused && player.currentTime === poster) return
    player.pause()
    player.seek(poster)
  })

  return (
    <Show
      when={!file().failed && (broken() === undefined || broken() !== file().path)}
      fallback={<TileLabel item={props.item} />}
    >
      <Show when={file().path}>
        {(path) => {
          onCleanup(() => setVideo(undefined))
          return (
            <>
              <video
                ref={setVideo}
                audio={false}
                source={path()}
                loop
                fit="cover"
                maxFps={media.thumbnailFps()}
                width="100%"
                height="100%"
                onReady={(metadata) => {
                  setDuration(metadata.duration)
                  media.noteDuration(props.item, metadata.duration)
                }}
                onError={() => setBroken(path())}
              />
              <box position="absolute" left={0} bottom={0} zIndex={1} backgroundColor={theme.background.raised.high}>
                <text fg={theme.text.base} wrapMode="none" selectable={false}>
                  {duration() === undefined ? "▶" : `▶ ${formatDuration(duration()!)}`}
                </text>
              </box>
            </>
          )
        }}
      </Show>
    </Show>
  )
}

/**
 * Mouse handlers that call `run` on a left press and release over the same element. A release that ends a text
 * selection reaches copy-on-select instead, and a drag that started elsewhere, or left the element, clicks nothing.
 */
export function createMediaClick(run: () => void) {
  const renderer = useRenderer()
  let pressed = false
  return {
    onMouseDown: (event: MouseEvent) => (pressed = event.button === 0),
    onMouseUp: (event: MouseEvent) => {
      const press = pressed
      pressed = false
      if (!press || !isMediaClick(renderer, event)) return
      // The element that a drag started on gets its release wherever it ends.
      const element = event.currentTarget!
      if (event.x < element.x || event.x >= element.x + element.width) return
      if (event.y < element.y || event.y >= element.y + element.height) return
      event.stopPropagation()
      run()
    },
  }
}

/** Whether a release is a left click and not the end of a text selection, which must reach copy-on-select. */
export function isMediaClick(renderer: CliRenderer, event: MouseEvent) {
  return event.button === 0 && !event.isDragging && !renderer.getSelection()?.getSelectedText()
}

/** Where a paused tile shows its poster: 10% in, past the fade most clips open with, and at most 30 s. */
export function posterTime(duration: number) {
  return duration < 3 ? 0 : Math.min(duration * 0.1, 30)
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const clock = `${minutes % 60}:${String(total % 60).padStart(2, "0")}`
  return total >= 3600 ? `${Math.floor(total / 3600)}:${clock.padStart(5, "0")}` : clock
}
