import type { CliRenderer, MouseEvent, VideoRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, createUniqueId, Match, onCleanup, Show, Switch } from "solid-js"
import { useMedia } from "../../context/media"
import { useTheme } from "../../context/theme"
import { isPlayableVideo, type MediaItem } from "./model"
import { createImageSource, createVideoFile } from "./source"

/**
 * A thumbnail for an image or video. A video shows a poster frame and, while the pointer is over it, plays silently
 * in a loop as the one active tile; leaving it pauses and returns to the poster. A click calls `onOpen`.
 */
export function MediaTile(props: { item: MediaItem; width: number; height: number; onOpen?: () => void }) {
  const media = useMedia()
  const theme = useTheme()
  const renderer = useRenderer()
  const key = createUniqueId()
  let hovered = false
  onCleanup(() => media.activeTile() === key && media.setActiveTile(undefined))

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      position="relative"
      backgroundColor={theme.background.raised.base}
      onMouseOver={() => {
        hovered = true
        if (isPlayableVideo(props.item)) media.setActiveTile(key)
      }}
      onMouseOut={() => {
        hovered = false
        // Moving between the tile's own children fires out and then over; only leaving the tile releases it.
        queueMicrotask(() => !hovered && media.activeTile() === key && media.setActiveTile(undefined))
      }}
      onMouseUp={(event: MouseEvent) => {
        if (!isMediaClick(renderer, event)) return
        event.stopPropagation()
        props.onOpen?.()
      }}
    >
      <Switch fallback={<TileLabel item={props.item} />}>
        <Match when={props.item.kind === "image"}>
          <TileImage item={props.item} />
        </Match>
        <Match when={isPlayableVideo(props.item)}>
          <TileVideo item={props.item} active={media.activeTile() === key} />
        </Match>
      </Switch>
    </box>
  )
}

function TileLabel(props: { item: MediaItem }) {
  const theme = useTheme()
  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center">
      <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
        {props.item.name ? `${props.item.kind} · ${props.item.name}` : props.item.kind}
      </text>
    </box>
  )
}

function TileImage(props: { item: MediaItem }) {
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
                onReady={(metadata) => setDuration(metadata.duration)}
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
