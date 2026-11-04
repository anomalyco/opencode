import type { CliRenderer, MouseEvent, VideoRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, createUniqueId, Match, on, onCleanup, Show, Switch } from "solid-js"
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
  const playable = () => isPlayableVideo(props.item)
  let hovered = false

  onCleanup(() => {
    if (media.activeTile() === key) media.setActiveTile(undefined)
  })

  const [failed, setFailed] = createSignal(false)
  createEffect(
    on(
      () => props.item,
      () => setFailed(false),
      { defer: true },
    ),
  )

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      position="relative"
      backgroundColor={theme.background.raised.base}
      onMouseOver={() => {
        hovered = true
        if (playable()) media.setActiveTile(key)
      }}
      onMouseOut={() => {
        hovered = false
        // Moving between the tile's own children fires out and then over; only leaving the tile releases it.
        queueMicrotask(() => {
          if (!hovered && media.activeTile() === key) media.setActiveTile(undefined)
        })
      }}
      onMouseUp={(event: MouseEvent) => {
        if (!isMediaClick(renderer, event)) return
        event.stopPropagation()
        props.onOpen?.()
      }}
    >
      <Switch
        fallback={
          <box width="100%" height="100%" alignItems="center" justifyContent="center">
            <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
              {props.item.name ? `${props.item.kind} · ${props.item.name}` : props.item.kind}
            </text>
          </box>
        }
      >
        <Match when={!failed() && props.item.kind === "image"}>
          <TileImage item={props.item} onFail={() => setFailed(true)} />
        </Match>
        <Match when={!failed() && playable()}>
          <TileVideo item={props.item} active={media.activeTile() === key} onFail={() => setFailed(true)} />
        </Match>
      </Switch>
    </box>
  )
}

function TileImage(props: { item: MediaItem; onFail: () => void }) {
  const source = createImageSource(() => props.item)
  createEffect(() => {
    if (source.failed()) props.onFail()
  })
  return (
    <image source={source.source()} fit="cover" protocol="auto" width="100%" height="100%" onError={source.onError} />
  )
}

function TileVideo(props: { item: MediaItem; active: boolean; onFail: () => void }) {
  const media = useMedia()
  const theme = useTheme()
  const file = createVideoFile(() => props.item)
  const [video, setVideo] = createSignal<VideoRenderable>()
  const [duration, setDuration] = createSignal<number>()
  const badge = () => {
    const seconds = duration()
    return seconds === undefined ? "▶" : `▶ ${formatDuration(seconds)}`
  }

  createEffect(() => {
    if (file().failed) props.onFail()
  })

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
              maxFps={media.capabilities().thumbnailFps}
              width="100%"
              height="100%"
              onReady={(metadata) => setDuration(metadata.duration)}
              onError={props.onFail}
            />
            <box position="absolute" left={0} bottom={0} zIndex={1} backgroundColor={theme.background.raised.high}>
              <text fg={theme.text.base} wrapMode="none" selectable={false}>
                {badge()}
              </text>
            </box>
          </>
        )
      }}
    </Show>
  )
}

/** Whether a release is a left click and not the end of a text selection, which must reach copy-on-select. */
export function isMediaClick(renderer: CliRenderer, event: MouseEvent) {
  return event.button === 0 && !event.isDragging && !renderer.getSelection()?.getSelectedText()
}

/** Where a paused tile shows its poster: 10% in, past the fade most clips open with, and at most 30 s. */
export function posterTime(duration: number) {
  if (duration < 3) return 0
  return Math.min(duration * 0.1, 30)
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, "0")
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
  return `${minutes}:${rest}`
}
