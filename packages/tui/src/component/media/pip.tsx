import type { MouseEvent, VideoMetadata, VideoRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createSignal, Match, on, Show, Switch } from "solid-js"
import { Keymap } from "../../context/keymap"
import { MEDIA_PIP_Z_INDEX, useMedia, type MediaPip as MediaPipState } from "../../context/media"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { formatTimecode, SeekBar, togglePlayback } from "./seek-bar"
import { createVideoFile } from "./source"
import { isMediaClick } from "./tile"

/** Rows kept free below a PiP that has not been dragged, so it sits above the prompt. */
const PROMPT_ROWS = 8

/** The floating mini player, shown while `useMedia().pip()` is set. It never takes keyboard focus. */
export function MediaPip(props: { pip: MediaPipState }) {
  const media = useMedia()
  const dialog = useDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const file = createVideoFile(() => props.pip.item)
  const [player, setPlayer] = createSignal<VideoRenderable>()
  const [metadata, setMetadata] = createSignal<VideoMetadata>()
  const [time, setTime] = createSignal(props.pip.time)
  const [playing, setPlaying] = createSignal(false)
  const [muted, setMuted] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [moved, setMoved] = createSignal<{ left: number; top: number }>()
  // Sound would play on the remote machine in a remote session.
  const audio = renderer.capabilities?.remote !== true
  // The viewer covers the PiP; it pauses meanwhile and resumes after.
  let resume = false

  const width = () =>
    Math.max(Math.min(24, dimensions().width), Math.min(48, Math.round(dimensions().width / 3), dimensions().width - 2))
  const aspect = () => {
    const value = metadata()
    return value && value.height > 0 ? value.width / value.height : 16 / 9
  }
  const videoHeight = () =>
    Math.max(2, Math.min(Math.round(width() / (aspect() * media.cellAspect())), Math.floor(dimensions().height / 2)))
  const height = () => videoHeight() + 2
  const place = () => {
    const position = moved() ?? {
      left: dimensions().width - width() - 2,
      top: dimensions().height - height() - PROMPT_ROWS,
    }
    return {
      left: Math.max(0, Math.min(dimensions().width - width(), position.left)),
      top: Math.max(0, Math.min(dimensions().height - height(), position.top)),
    }
  }

  function toggle() {
    const video = player()
    if (video) togglePlayback(video)
  }

  function expand() {
    const video = player()
    const playback = {
      time: video?.currentTime ?? props.pip.time,
      playing: video ? video.playing || resume : props.pip.playing,
    }
    batch(() => {
      media.closePip()
      media.openViewer([props.pip.item], 0, playback)
    })
  }

  createEffect(
    on(
      () => media.viewer() !== undefined,
      (open) => {
        const video = player()
        if (!video) return
        if (open && video.playing) {
          resume = true
          video.pause()
          return
        }
        if (open || !resume) return
        resume = false
        video.play()
      },
      { defer: true },
    ),
  )

  const commands = [
    { id: "media.pip.toggle", title: "play or pause", run: toggle },
    { id: "media.pip.expand", title: "open in viewer", run: expand },
    { id: "media.pip.close", title: "close", run: media.closePip },
  ] as const
  Keymap.createLayer(() => ({
    mode: "global",
    commands: commands.map((command) => ({
      id: command.id,
      title: `Picture-in-picture: ${command.title}`,
      group: "Media",
      palette: true,
      bind: false,
      run: () => {
        command.run()
        if (dialog.stack.length > 0) dialog.clear()
      },
    })),
  }))
  Keymap.createLayer(() => ({ bindings: commands.map((command) => command.id) }))

  const click = (run: () => void) => (event: MouseEvent) => {
    if (isMediaClick(renderer, event)) run()
  }

  let drag: { x: number; y: number; left: number; top: number } | undefined

  return (
    <box
      id="media-pip"
      position="absolute"
      left={place().left}
      top={place().top}
      width={width()}
      height={height()}
      zIndex={MEDIA_PIP_Z_INDEX}
      flexDirection="column"
      backgroundColor={theme.background.raised.base}
    >
      <box
        id="media-pip-title"
        height={1}
        flexShrink={0}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        gap={1}
        backgroundColor={theme.background.raised.high}
        onMouseDown={(event: MouseEvent) => {
          if (event.button !== 0) return
          event.stopPropagation()
          drag = { x: event.x, y: event.y, ...place() }
        }}
        onMouseDrag={(event: MouseEvent) => {
          if (!drag) return
          event.stopPropagation()
          setMoved({ left: drag.left + event.x - drag.x, top: drag.top + event.y - drag.y })
        }}
        onMouseUp={() => {
          drag = undefined
        }}
      >
        <text fg={theme.text.muted} flexShrink={0} selectable={false}>
          ⠿
        </text>
        <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1} selectable={false}>
          {props.pip.item.name ?? "video"}
        </text>
      </box>
      <box height={videoHeight()} flexShrink={0} onMouseUp={click(toggle)}>
        <Switch>
          <Match when={failed() || file().failed}>
            <box width="100%" height="100%" alignItems="center" justifyContent="center">
              <text fg={theme.text.feedback.error.base}>Can't play this video</text>
            </box>
          </Match>
          <Match when={file().path}>
            {(source) => (
              <video
                ref={setPlayer}
                audio={audio}
                source={source()}
                muted={muted()}
                fit="fit"
                width="100%"
                height="100%"
                onReady={(value) => {
                  setMetadata(value)
                  const video = player()
                  if (!video) return
                  if (props.pip.time) video.seek(Math.min(value.duration, props.pip.time))
                  setTime(video.currentTime)
                  if (!props.pip.playing) return
                  if (media.viewer()) resume = true
                  else video.play()
                }}
                onError={() => setFailed(true)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnd={() => setPlaying(player()?.playing ?? false)}
                onTimeUpdate={setTime}
              />
            )}
          </Match>
        </Switch>
      </box>
      <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
        <text id="media-pip-play" fg={theme.text.base} flexShrink={0} selectable={false} onMouseUp={click(toggle)}>
          {playing() ? "⏸" : "▶"}
        </text>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
          {formatTimecode(time())}
        </text>
        <SeekBar
          duration={metadata()?.duration ?? 0}
          time={time()}
          onSeek={(target) => {
            player()?.seek(target)
            setTime(target)
          }}
        />
        <Show when={audio && metadata()?.hasAudio}>
          <text
            fg={muted() ? theme.text.muted : theme.text.formfield.selected}
            flexShrink={0}
            selectable={false}
            onMouseUp={click(() => setMuted((value) => !value))}
          >
            ♪
          </text>
        </Show>
        <text id="media-pip-expand" fg={theme.text.base} flexShrink={0} selectable={false} onMouseUp={click(expand)}>
          ⤢
        </text>
        <text
          id="media-pip-close"
          fg={theme.text.base}
          flexShrink={0}
          selectable={false}
          onMouseUp={click(media.closePip)}
        >
          ✕
        </text>
      </box>
    </box>
  )
}
