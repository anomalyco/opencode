import { CliRenderEvents, RGBA, type BoxRenderable, type MouseEvent, type Renderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { Keymap } from "../../context/keymap"
import { MEDIA_VIEWER_Z_INDEX, registerMediaViews, useMedia, type MediaViewerRequest } from "../../context/media"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { isPlayableVideo, type MediaItem } from "./model"
import { MediaPip } from "./pip"
import { createTransport, Toggle, TransportControls } from "./seek-bar"
import { createImageSource, createVideoFile } from "./source"
import { formatDuration, MediaTile } from "./tile"
import { actualZoom, fillZoom, initialView, layoutView, panBy, zoomAt, type Size, type ZoomView } from "./zoom"

registerMediaViews({ viewer: MediaViewer, pip: MediaPip })

const TILE_WIDTH = 12
const TILE_HEIGHT = 4
const PLAYABLE_HINT = "The viewer plays MP4, MOV and M4V files with H.264 video and AAC audio."

/** The fullscreen viewer over a gallery, shown while `useMedia().viewer()` holds a request. */
function MediaViewer(props: { request: MediaViewerRequest }) {
  const media = useMedia()
  const dialog = useDialog()
  const keymap = Keymap.use()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const items = props.request.items
  // Sound is off in a remote session, where it would play on the remote machine, and after a failed open with sound.
  const remote = renderer.capabilities?.remote === true

  const [index, setIndex] = createSignal(props.request.index)
  const [image, setImage] = createSignal<Size>()
  // A failure is its title and explanation lines.
  const [error, setError] = createSignal<string[]>()
  const [view, setView] = createSignal<ZoomView>()
  const [stage, setStage] = createSignal<Size>({ width: 0, height: 0 })
  const [audio, setAudio] = createSignal(!remote)
  const [muted, setMuted] = createSignal(false)
  const [volume, setVolume] = createSignal(1)
  const [loop, setLoop] = createSignal(false)
  const [info, setInfo] = createSignal(false)
  // The request's time and playing state apply to the item it opened at.
  let start: Partial<MediaViewerRequest> = props.request
  const transport = createMemo(on(index, () => createTransport(start)))
  let stageBox: BoxRenderable | undefined

  const current = () => items[index()]!
  const failure = createMemo(() => error() ?? unsupported(current()))
  const playable = () => current().kind === "video" && !failure()
  const video = () => (playable() ? transport().player() : undefined)
  const metadata = () => transport().metadata()
  const facts = () => metadata() ?? image()
  const geometry = createMemo(() => {
    const source = facts()
    if (!source?.width || !source.height || stage().width < 1 || stage().height < 1) return undefined
    return { source: { width: source.width, height: source.height }, stage: stage(), cellAspect: media.cellAspect() }
  })
  const layout = createMemo(() => {
    const value = geometry()
    return value && layoutView(value, view() ?? initialView(value.source))
  })
  const zoomed = () => (layout()?.view.zoom ?? 1) > 1
  const percent = () => `${Math.round(layout()!.scale * media.cellPixels() * 100)}%`
  const fps = () => metadata()?.fps || 30
  const length = () => metadata()?.duration ?? 0

  // The viewer takes the keys: whatever takes focus while it is open, such as a dialog closing behind it giving focus
  // back to the prompt, is blurred and gets it back once the viewer closes.
  let focused = renderer.currentFocusedRenderable
  focused?.blur()
  const hold = (renderable: Renderable | null) => {
    if (!renderable || dialog.stack.length > 0) return
    focused = renderable
    renderable.blur()
  }
  renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, hold)
  onCleanup(() => {
    renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, hold)
    setTimeout(() => {
      if (!focused || focused.isDestroyed || dialog.stack.length > 0 || renderer.currentFocusedRenderable) return
      focused.focus()
    }, 1)
  })
  onCleanup(keymap.mode.push("modal"))

  function go(next: number) {
    const target = (next + items.length) % items.length
    if (target === index()) return
    start = {}
    batch(() => {
      setIndex(target)
      setImage(undefined)
      setError(undefined)
      setView(undefined)
      setAudio(!remote)
    })
  }

  const seek = (target: number) => video() && transport().seek(target)

  function step(frames: number) {
    const player = video()
    if (!player) return
    player.pause()
    seek((Math.round(player.currentTime * fps()) + frames) / fps())
  }

  function zoom(next: (value: NonNullable<ReturnType<typeof geometry>>, view: ZoomView) => ZoomView) {
    const value = geometry()
    if (value) setView(next(value, layout()!.view))
  }

  function arrow(dx: number, dy: number) {
    if (current().kind === "image" && !zoomed()) return dx === 0 ? undefined : go(index() + dx)
    const area = stage()
    if (current().kind === "image")
      return zoom((value, view) =>
        panBy(value, view, -dx * Math.ceil(area.width / 8), -dy * Math.ceil(area.height / 8)),
      )
    if (dx !== 0) return seek(transport().time() + dx * 5)
    if (video()) setVolume((value) => Math.round(Math.max(0, Math.min(1, value - dy * 0.1)) * 10) / 10)
  }

  function pip() {
    const player = video()
    if (!player) return
    const playback = { time: player.currentTime, playing: player.playing }
    batch(() => {
      media.closeViewer()
      media.openPip(current(), playback)
    })
  }

  // Another mode, such as a question form mounting behind the viewer, takes the keys; a playing video moves to PiP.
  createEffect(
    on(
      keymap.mode.current,
      (mode) => {
        if (mode === "modal") return
        if (video()?.playing) return pip()
        media.closeViewer()
      },
      { defer: true },
    ),
  )

  const toggleMute = () => setMuted((value) => !value)
  const toggleLoop = () => setLoop((value) => !value)
  const command = (bind: string, title: string, run: () => void) => ({ bind, title, group: "Media", run })
  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: dialog.stack.length === 0,
    commands: [
      command("escape,q,ctrl+c", "Close viewer", media.closeViewer),
      command("[,pageup", "Previous item", () => go(index() - 1)),
      command("],pagedown", "Next item", () => go(index() + 1)),
      command("left", "Previous image, pan or seek back", () => arrow(-1, 0)),
      command("right", "Next image, pan or seek forward", () => arrow(1, 0)),
      command("up", "Pan up or volume up", () => arrow(0, -1)),
      command("down", "Pan down or volume down", () => arrow(0, 1)),
      command("shift+left", "Seek back 1s", () => seek(transport().time() - 1)),
      command("shift+right", "Seek forward 1s", () => seek(transport().time() + 1)),
      command("space", "Play or pause", () => video() && transport().toggle()),
      command(".", "Next frame", () => step(1)),
      ...Array.from({ length: 10 }, (_, digit) =>
        command(String(digit), `Go to ${digit * 10}%`, () => seek((length() * digit) / 10)),
      ),
      command("m", "Mute", toggleMute),
      command("l", "Loop", toggleLoop),
      command("+,=", "Zoom in", () => zoom((value, view) => zoomAt(value, view, 1.5))),
      command("-", "Zoom out", () => zoom((value, view) => zoomAt(value, view, 1 / 1.5))),
      command("r", "Reset zoom", () => setView(undefined)),
      command("f", "Cycle fit, fill and actual size", () =>
        zoom((value, view) => {
          const targets = [fillZoom(value), actualZoom(value, media.cellPixels())].sort((a, b) => a - b)
          return { ...view, zoom: targets.find((target) => target > view.zoom + 1e-3) ?? 1 }
        }),
      ),
      command("i", "Media info", () => setInfo((value) => !value)),
      command("p", "Picture-in-picture", pip),
    ],
  }))

  // A comma splits key bindings, so the previous-frame key is read directly.
  onCleanup(
    keymap.intercept("key", (context) => {
      const event = context.event
      if (dialog.stack.length > 0 || event.ctrl || event.meta || (event.name !== "," && event.sequence !== ",")) return
      step(-1)
      context.consume()
    }),
  )

  const size = () => facts() && `${facts()!.width}×${facts()!.height}`
  const duration = () => metadata() && formatDuration(metadata()!.duration)
  const fpsLabel = () => metadata()?.fps && `${+metadata()!.fps.toFixed(2)} fps`
  const audible = () => !!metadata()?.hasAudio && audio() && !muted()
  const sound = () => (metadata()?.hasAudio ? (audible() ? `♪ ${Math.round(volume() * 100)}%` : "♪ off") : "no audio")

  // Most useful first: the footer drops the hints that do not fit.
  const hints = createMemo(() => {
    const zoomable = geometry() !== undefined
    const all = [
      "esc close",
      items.length > 1 && (current().kind === "image" && !zoomed() ? "←→ [ ] prev/next" : "[ ] prev/next"),
      playable() && `space ${transport().playing() ? "pause" : "play"}`,
      playable() && "←→ ±5s",
      zoomed() && (playable() ? "drag pan" : "←↑↓→ pan"),
      zoomed() && "r reset",
      playable() && ", . frame",
      playable() && `m ${muted() ? "unmute" : "mute"}`,
      playable() && "p pip",
      zoomable && "+ - zoom",
      zoomable && "f fit",
      "i info",
    ].filter((hint): hint is string => typeof hint === "string")
    let room = dimensions().width
    return all.filter((hint) => (room -= hint.length + 2) >= 0)
  })

  const strip = createMemo(() => {
    const count = Math.max(1, Math.floor((dimensions().width - 1) / (TILE_WIDTH + 1)))
    const first = Math.max(0, Math.min(items.length - count, index() - Math.floor(count / 2)))
    return items.slice(first, first + count)
  })

  const infoRows = () => {
    const area = layout()
    return [
      ["file", current().name ?? current().id],
      ["type", current().mime || current().kind],
      ["size", size() || "…"],
      ...(current().kind === "video"
        ? [
            ["fps", fpsLabel() || "…"],
            ["duration", duration() || "…"],
            ["audio", sound()],
            ["quality", transport().tier() ? `tier ${transport().tier()} · reduced to keep up` : "tier 0 · full size"],
          ]
        : []),
      ["protocol", media.protocol()],
      [
        "zoom",
        area && zoomed()
          ? `${percent()} · ${area.crop.width}×${area.crop.height} at ${area.crop.left},${area.crop.top}`
          : "fit",
      ],
    ]
  }

  function VideoStage(stageProps: { item: MediaItem }) {
    const file = createVideoFile(() => stageProps.item)
    createEffect(() => {
      if (file().failed) setError(["Couldn't load this video", "No source could supply its bytes."])
    })
    return (
      <Show when={file().path}>
        {(source) => (
          <video
            audio={audio()}
            source={source()}
            muted={muted()}
            volume={volume()}
            loop={loop()}
            fit="fit"
            crop={layout()?.crop}
            width="100%"
            height="100%"
            {...transport().events}
            onError={(cause) => {
              // A video that fails to open with sound may still open without it, e.g. with no audio device.
              const player = transport().player()
              if (!audio() || !player || player.ready)
                return setError(["Can't play this video", cause.message, PLAYABLE_HINT])
              setAudio(false)
              player.play()
            }}
          />
        )}
      </Show>
    )
  }

  function ImageStage(stageProps: { item: MediaItem }) {
    const source = createImageSource(() => stageProps.item)
    createEffect(() => {
      if (source.failed()) setError(["Couldn't load this image"])
    })
    return (
      <image
        source={source.source()}
        fit="fit"
        crop={layout()?.crop}
        protocol="auto"
        width="100%"
        height="100%"
        onLoad={(loaded) => setImage({ width: loaded.width, height: loaded.height })}
        onError={source.onError}
      />
    )
  }

  let drag: { x: number; y: number; view?: ZoomView; moved: boolean } | undefined

  return (
    <box
      id="media-viewer"
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      zIndex={MEDIA_VIEWER_Z_INDEX}
      backgroundColor={opaque(theme.background.base)}
      flexDirection="column"
    >
      <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={2}>
        <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1} selectable={false}>
          {current().name ?? current().kind}
        </text>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
          {[
            items.length > 1 && `${index() + 1} / ${items.length}`,
            size(),
            duration(),
            fpsLabel(),
            zoomed() && percent(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </text>
        <box flexGrow={1} />
        <text fg={theme.text.muted} flexShrink={0} selectable={false} onMouseUp={media.closeViewer}>
          esc
        </text>
      </box>
      <box
        id="media-viewer-stage"
        ref={(element: BoxRenderable) => (stageBox = element)}
        flexGrow={1}
        minHeight={1}
        position="relative"
        onSizeChange={function (this: BoxRenderable) {
          setStage({ width: this.width, height: this.height })
        }}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0)
            drag = { x: event.x, y: event.y, view: zoomed() ? layout()?.view : undefined, moved: false }
        }}
        onMouseDrag={(event: MouseEvent) => {
          const value = geometry()
          if (!drag || !value) return
          drag.moved ||= event.x !== drag.x || event.y !== drag.y
          if (drag.view) setView(panBy(value, drag.view, event.x - drag.x, event.y - drag.y))
        }}
        onMouseUp={(event: MouseEvent) => {
          const pressed = drag
          drag = undefined
          if (event.button === 0 && pressed && !pressed.moved && video()) transport().toggle()
        }}
        onMouseScroll={(event: MouseEvent) => {
          const direction = event.scroll?.direction
          if (!geometry() || (direction !== "up" && direction !== "down")) return
          event.stopPropagation()
          const point = { x: event.x - (stageBox?.x ?? 0), y: event.y - (stageBox?.y ?? 0) }
          zoom((value, view) => zoomAt(value, view, direction === "up" ? 1.25 : 0.8, point))
        }}
      >
        <Show
          when={failure()}
          fallback={
            <Show when={current()} keyed>
              {(item) => (
                <Switch>
                  <Match when={item.kind === "image"}>
                    <ImageStage item={item} />
                  </Match>
                  <Match when={item.kind === "video"}>
                    <VideoStage item={item} />
                  </Match>
                </Switch>
              )}
            </Show>
          }
        >
          {(value) => (
            <box
              id="media-viewer-failure"
              width="100%"
              height="100%"
              alignItems="center"
              justifyContent="center"
              flexDirection="column"
              gap={1}
              paddingLeft={2}
              paddingRight={2}
            >
              <For each={value()}>
                {(line, index) => (
                  <text fg={index() === 0 ? theme.text.feedback.error.base : theme.text.muted} wrapMode="word">
                    {line}
                  </text>
                )}
              </For>
            </box>
          )}
        </Show>
        <Show when={info()}>
          <box
            id="media-viewer-info"
            position="absolute"
            top={0}
            right={1}
            zIndex={5}
            padding={1}
            flexDirection="column"
            backgroundColor={theme.background.raised.base}
          >
            <For each={infoRows()}>
              {(row) => (
                <text wrapMode="none" selectable={false}>
                  <span style={{ fg: theme.text.muted }}>{row[0]!.padEnd(10)}</span>
                  <span style={{ fg: theme.text.base }}>{row[1]}</span>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
      <Show when={playable() && transport().metadata()}>
        <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
          <TransportControls transport={transport()} total preview />
          <Toggle on={audible()} run={toggleMute}>
            {sound()}
          </Toggle>
          <Toggle on={loop()} run={toggleLoop}>
            loop
          </Toggle>
        </box>
      </Show>
      <Show when={items.length > 1 && dimensions().height >= 22}>
        <box
          id="media-viewer-filmstrip"
          height={TILE_HEIGHT + 2}
          paddingTop={1}
          flexDirection="row"
          justifyContent="center"
          gap={1}
        >
          <For each={strip()}>
            {(item) => (
              <box flexDirection="column" width={TILE_WIDTH}>
                <MediaTile item={item} width={TILE_WIDTH} height={TILE_HEIGHT} onOpen={() => go(items.indexOf(item))} />
                <text fg={theme.text.formfield.selected} wrapMode="none" selectable={false}>
                  {items.indexOf(item) === index() ? "━".repeat(TILE_WIDTH) : ""}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <box id="media-viewer-footer" height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={2}>
        <For each={hints()}>
          {(hint) => (
            <text wrapMode="none" flexShrink={0} selectable={false}>
              <span style={{ fg: theme.text.base }}>{hint.slice(0, hint.lastIndexOf(" "))}</span>
              <span style={{ fg: theme.text.muted }}>{hint.slice(hint.lastIndexOf(" "))}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

function unsupported(item: MediaItem) {
  if (item.kind === "other") return ["No preview for this file", item.mime]
  if (item.kind === "video" && !isPlayableVideo(item)) return [`Can't play ${item.mime || "this video"}`, PLAYABLE_HINT]
  return undefined
}

// A theme that follows the terminal's background leaves it transparent, which would show the screen underneath.
function opaque(color: RGBA) {
  return color.a === 1 ? color : RGBA.fromValues(color.r, color.g, color.b, 1)
}
