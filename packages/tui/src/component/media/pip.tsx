import type { MouseEvent } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createSignal, Match, on, Show, Switch } from "solid-js"
import { Keymap } from "../../context/keymap"
import { MEDIA_PIP_Z_INDEX, useMedia, type MediaPipRequest } from "../../context/media"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { createTransport, Toggle, TransportControls } from "./seek-bar"
import { createVideoFile } from "./source"
import { createMediaClick } from "./tile"

/** The floating mini player, shown while `useMedia().pip()` is set. It never takes keyboard focus. */
export function MediaPip(props: { pip: MediaPipRequest }) {
  const media = useMedia()
  const dialog = useDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const file = createVideoFile(() => props.pip.item)
  // It opens paused; the effect below starts it once ready, or once the viewer covering it closes.
  const transport = createTransport({ time: props.pip.time, playing: false })
  const [muted, setMuted] = createSignal(props.pip.muted ?? false)
  const [failed, setFailed] = createSignal(false)
  const [moved, setMoved] = createSignal<{ left: number; top: number }>()
  // Sound would play on the remote machine in a remote session.
  const audio = renderer.capabilities?.remote !== true
  // The viewer covers the PiP; it pauses meanwhile and resumes after.
  let resume = props.pip.playing !== false

  const width = () => Math.max(Math.min(24, dimensions().width), Math.min(48, Math.round(dimensions().width / 3)))
  const videoHeight = () => {
    const metadata = transport.metadata()
    const aspect = metadata && metadata.height > 0 ? metadata.width / metadata.height : 16 / 9
    return Math.max(
      2,
      Math.min(Math.round(width() / (aspect * media.cellAspect())), Math.floor(dimensions().height / 2)),
    )
  }
  // Until dragged, it sits at the right above the prompt.
  const place = () => {
    const position = moved() ?? {
      left: dimensions().width - width() - 2,
      top: dimensions().height - videoHeight() - 10,
    }
    return {
      left: Math.max(0, Math.min(dimensions().width - width(), position.left)),
      top: Math.max(0, Math.min(dimensions().height - videoHeight() - 2, position.top)),
    }
  }

  function expand() {
    const playback = {
      time: transport.position(),
      // Before it is ready, or under the viewer, it is paused but plays once it can.
      playing: transport.player()?.playing || resume,
      muted: muted(),
      volume: props.pip.volume,
      loop: props.pip.loop,
    }
    batch(() => {
      media.closePip()
      media.openViewer([props.pip.item], 0, playback)
    })
  }

  createEffect(
    on([() => media.viewer() !== undefined, transport.metadata], ([open, ready]) => {
      const video = transport.player()
      if (!ready || !video) return
      if (open && video.playing) {
        resume = true
        return video.pause()
      }
      if (open || !resume) return
      resume = false
      video.play()
    }),
  )

  const commands = [
    { id: "media.pip.toggle", title: "play or pause", run: transport.toggle },
    { id: "media.pip.expand", title: "open in viewer", run: expand },
    { id: "media.pip.close", title: "close", run: media.closePip },
  ]
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

  const toggleClick = createMediaClick(transport.toggle)
  const expandClick = createMediaClick(expand)
  const closeClick = createMediaClick(media.closePip)
  let drag: { x: number; y: number; left: number; top: number } | undefined

  return (
    <box
      id="media-pip"
      position="absolute"
      left={place().left}
      top={place().top}
      width={width()}
      height={videoHeight() + 2}
      zIndex={MEDIA_PIP_Z_INDEX}
      flexDirection="column"
      backgroundColor={theme.background.raised.base}
    >
      <box
        id="media-pip-title"
        height={1}
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
        onMouseUp={() => (drag = undefined)}
      >
        <text fg={theme.text.muted} flexShrink={0} selectable={false}>
          ⠿
        </text>
        <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1} selectable={false}>
          {props.pip.item.name ?? "video"}
        </text>
      </box>
      <box height={videoHeight()} {...toggleClick}>
        <Switch>
          <Match when={failed() || file().failed}>
            <box width="100%" height="100%" alignItems="center" justifyContent="center">
              <text fg={theme.text.feedback.error.base}>Can't play this video</text>
            </box>
          </Match>
          <Match when={file().path}>
            {(source) => (
              <video
                audio={audio}
                source={source()}
                muted={muted()}
                volume={props.pip.volume}
                loop={props.pip.loop}
                fit="fit"
                width="100%"
                height="100%"
                {...transport.events}
                onError={() => setFailed(true)}
              />
            )}
          </Match>
        </Switch>
      </box>
      <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
        <TransportControls transport={transport} />
        <Show when={audio && transport.metadata()?.hasAudio}>
          <Toggle on={!muted()} run={() => setMuted((value) => !value)}>
            ♪
          </Toggle>
        </Show>
        <text id="media-pip-expand" fg={theme.text.base} selectable={false} {...expandClick}>
          ⤢
        </text>
        <text id="media-pip-close" fg={theme.text.base} selectable={false} {...closeClick}>
          ✕
        </text>
      </box>
    </box>
  )
}
