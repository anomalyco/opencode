import {
  CliRenderEvents,
  RGBA,
  type BoxRenderable,
  type MouseEvent,
  type Renderable,
  type VideoRenderable,
} from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { Keymap } from "../../context/keymap"
import {
  MEDIA_VIEWER_Z_INDEX,
  registerMediaViews,
  useMedia,
  type MediaPlayback,
  type MediaViewerRequest,
} from "../../context/media"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { isPlayableVideo, type MediaItem } from "./model"
import { MediaPip } from "./pip"
import { formatTimecode, SeekBar, togglePlayback } from "./seek-bar"
import { createImageSource, createVideoFile } from "./source"
import { formatDuration, MediaTile } from "./tile"
import {
  actualZoom,
  fillZoom,
  initialView,
  layoutView,
  panBy,
  zoomAt,
  type Size,
  type ZoomGeometry,
  type ZoomView,
} from "./zoom"

registerMediaViews({ viewer: MediaViewer, pip: MediaPip })

const TILE_WIDTH = 12
const TILE_HEIGHT = 4
// The filmstrip takes TILE_HEIGHT + 2 rows, so it shows only when the stage keeps most of the screen.
const FILMSTRIP_MIN_HEIGHT = 22
const SEEK_STEP = 5
const FINE_SEEK_STEP = 1
const ZOOM_STEP = 1.5
const WHEEL_STEP = 1.25
const PLAYABLE_HINT = "The viewer plays MP4, MOV and M4V files with H.264 video and AAC audio."

type Facts = Readonly<{ width?: number; height?: number; fps?: number; duration?: number; hasAudio?: boolean }>
type Failure = Readonly<{ title: string; detail?: string; hint?: boolean }>

/** The fullscreen viewer over a gallery, shown while `useMedia().viewer()` holds a request. */
function MediaViewer(props: { request: MediaViewerRequest }) {
  const media = useMedia()
  const dialog = useDialog()
  const keymap = Keymap.use()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const items = props.request.items
  const remote = renderer.capabilities?.remote === true

  const [index, setIndex] = createSignal(props.request.index)
  const [facts, setFacts] = createSignal<Facts>({})
  const [error, setError] = createSignal<Failure>()
  const [view, setView] = createSignal<ZoomView>()
  const [stage, setStage] = createSignal<Size>({ width: 0, height: 0 })
  const [player, setPlayer] = createSignal<VideoRenderable>()
  const [time, setTime] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [tier, setTier] = createSignal(0)
  // Off in a remote session, where sound would play on the remote machine; off after a failed open with sound.
  const [audio, setAudio] = createSignal(!remote)
  const [muted, setMuted] = createSignal(false)
  const [volume, setVolume] = createSignal(1)
  const [loop, setLoop] = createSignal(false)
  const [info, setInfo] = createSignal(false)
  // The request's time and playing state apply to the item it opened at, once.
  let initial = true
  let resume = false
  let stageBox: BoxRenderable | undefined

  const current = () => items[index()]!
  const isVideo = () => current().kind === "video"
  const isImage = () => current().kind === "image"
  const failure = createMemo(() => error() ?? unsupported(current()))
  const geometry = createMemo((): ZoomGeometry | undefined => {
    const source = facts()
    const area = stage()
    if (!source.width || !source.height || area.width < 1 || area.height < 1) return undefined
    return { source: { width: source.width, height: source.height }, stage: area, cellAspect: media.cellAspect() }
  })
  const layout = createMemo(() => {
    const value = geometry()
    if (!value) return undefined
    return layoutView(value, view() ?? initialView(value.source))
  })
  const zoomed = () => (layout()?.view.zoom ?? 1) > 1
  const percent = () => `${Math.round(layout()!.scale * media.cellPixels() * 100)}%`
  // The player, while the transport controls apply to it.
  const controlled = () => (isVideo() && !failure() ? player() : undefined)
  const filmstrip = () => items.length > 1 && dimensions().height >= FILMSTRIP_MIN_HEIGHT

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
  onCleanup(() => renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, hold))
  onCleanup(keymap.mode.push("modal"))
  onCleanup(() => {
    // Like the dialog, give focus back once the viewer is gone, unless something else took it.
    setTimeout(() => {
      if (!focused || focused.isDestroyed || dialog.stack.length > 0 || renderer.currentFocusedRenderable) return
      focused.focus()
    }, 1)
  })

  function go(next: number) {
    const target = (next + items.length) % items.length
    if (target === index()) return
    initial = false
    batch(() => {
      setIndex(target)
      setFacts({})
      setError(undefined)
      setView(undefined)
      setPlayer(undefined)
      setTime(0)
      setPlaying(false)
      setTier(0)
      setAudio(!remote)
    })
  }

  function seek(target: number) {
    const video = controlled()
    if (video) video.seek(Math.max(0, Math.min(video.duration, target)))
  }

  function togglePlay() {
    const video = controlled()
    if (video) togglePlayback(video)
  }

  function step(frames: number) {
    const video = controlled()
    if (!video) return
    const fps = facts().fps || 30
    video.pause()
    seek((Math.round(video.currentTime * fps) + frames) / fps)
  }

  function zoomBy(factor: number) {
    const value = geometry()
    if (!value) return
    setView(zoomAt(value, layout()!.view, factor))
  }

  function pan(columns: number, rows: number) {
    const value = geometry()
    if (!value || !zoomed()) return
    setView(panBy(value, layout()!.view, columns, rows))
  }

  function cycleFit() {
    const value = geometry()
    if (!value) return
    const zoom = layout()!.view.zoom
    const targets = [fillZoom(value), actualZoom(value, media.cellPixels())].sort((a, b) => a - b)
    const next = targets.find((target) => target > zoom + 1e-3) ?? 1
    setView({ ...layout()!.view, zoom: next })
  }

  // Moves the view an eighth of the stage toward a direction.
  function nudge(dx: number, dy: number) {
    pan(-dx * Math.max(1, Math.round(stage().width / 8)), -dy * Math.max(1, Math.round(stage().height / 8)))
  }

  function arrow(dx: number, dy: number) {
    if (isImage() && !zoomed()) return dx === 0 ? undefined : go(index() + dx)
    if (isImage()) return nudge(dx, dy)
    if (dx !== 0) return seek(time() + dx * SEEK_STEP)
    if (controlled()) setVolume((value) => Math.round(Math.max(0, Math.min(1, value - dy * 0.1)) * 10) / 10)
  }

  function pip() {
    const video = controlled()
    if (!video) return
    const playback = { time: video.currentTime, playing: video.playing }
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
        if (player()?.playing) return pip()
        media.closeViewer()
      },
      { defer: true },
    ),
  )

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: dialog.stack.length === 0,
    commands: [
      { bind: "escape,q,ctrl+c", title: "Close viewer", group: "Media", run: media.closeViewer },
      { bind: "[,pageup", title: "Previous item", group: "Media", run: () => go(index() - 1) },
      { bind: "],pagedown", title: "Next item", group: "Media", run: () => go(index() + 1) },
      { bind: "left", title: "Previous image, pan or seek back", group: "Media", run: () => arrow(-1, 0) },
      { bind: "right", title: "Next image, pan or seek forward", group: "Media", run: () => arrow(1, 0) },
      { bind: "up", title: "Pan up or volume up", group: "Media", run: () => arrow(0, -1) },
      { bind: "down", title: "Pan down or volume down", group: "Media", run: () => arrow(0, 1) },
      { bind: "shift+left", title: "Seek back 1s", group: "Media", run: () => seek(time() - FINE_SEEK_STEP) },
      { bind: "shift+right", title: "Seek forward 1s", group: "Media", run: () => seek(time() + FINE_SEEK_STEP) },
      { bind: "alt+left", title: "Pan left", group: "Media", run: () => nudge(-1, 0) },
      { bind: "alt+right", title: "Pan right", group: "Media", run: () => nudge(1, 0) },
      { bind: "alt+up", title: "Pan up", group: "Media", run: () => nudge(0, -1) },
      { bind: "alt+down", title: "Pan down", group: "Media", run: () => nudge(0, 1) },
      { bind: "space", title: "Play or pause", group: "Media", run: togglePlay },
      { bind: ".", title: "Next frame", group: "Media", run: () => step(1) },
      { bind: "home", title: "Go to start", group: "Media", run: () => seek(0) },
      {
        bind: "end",
        title: "Go to end",
        group: "Media",
        run: () => seek((facts().duration ?? 0) - 1 / (facts().fps || 30)),
      },
      ...Array.from({ length: 10 }, (_, digit) => ({
        bind: String(digit),
        title: `Go to ${digit * 10}%`,
        group: "Media",
        run: () => seek(((facts().duration ?? 0) * digit) / 10),
      })),
      { bind: "m", title: "Mute", group: "Media", run: () => setMuted((value) => !value) },
      { bind: "l", title: "Loop", group: "Media", run: () => setLoop((value) => !value) },
      { bind: "+,=", title: "Zoom in", group: "Media", run: () => zoomBy(ZOOM_STEP) },
      { bind: "-", title: "Zoom out", group: "Media", run: () => zoomBy(1 / ZOOM_STEP) },
      { bind: "r", title: "Reset zoom", group: "Media", run: () => setView(undefined) },
      { bind: "f", title: "Cycle fit, fill and actual size", group: "Media", run: cycleFit },
      { bind: "i", title: "Media info", group: "Media", run: () => setInfo((value) => !value) },
      { bind: "p", title: "Picture-in-picture", group: "Media", run: pip },
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

  let drag: { x: number; y: number; view: ZoomView; moved: boolean } | undefined

  const size = () => (facts().width && facts().height ? `${facts().width}×${facts().height}` : undefined)
  const duration = () => (facts().duration !== undefined ? formatDuration(facts().duration!) : undefined)
  const fps = () => (facts().fps ? formatFps(facts().fps!) : undefined)
  const header = () =>
    [size(), duration(), fps() && `${fps()} fps`, zoomed() ? percent() : undefined].filter(Boolean).join(" · ")

  const hints = createMemo(() => {
    const video = isVideo() && !failure()
    const zoomable = geometry() !== undefined
    // Most useful first: the footer drops hints that do not fit.
    const all: [boolean, string, string][] = [
      [true, "esc", "close"],
      [items.length > 1, isImage() && !zoomed() ? "←→ [ ]" : "[ ]", "prev/next"],
      [video, "space", playing() ? "pause" : "play"],
      [video, "←→", `±${SEEK_STEP}s`],
      [zoomed(), isImage() ? "←↑↓→" : "alt+←↑↓→", "pan"],
      [zoomed(), "r", "reset"],
      [video, ", .", "frame"],
      [video, "m", muted() ? "unmute" : "mute"],
      [video, "p", "pip"],
      [zoomable, "+ -", "zoom"],
      [zoomable, "f", "fit"],
      [true, "i", "info"],
      [video, "⇧←→", `±${FINE_SEEK_STEP}s`],
      [video, "0-9", "jump"],
      [video, "↑↓", "volume"],
      [video, "l", "loop"],
    ]
    const room = dimensions().width - 2
    return all
      .filter((hint) => hint[0])
      .reduce<{ used: number; list: { key: string; label: string }[] }>(
        (result, hint) => {
          const width = hint[1].length + hint[2].length + 3
          if (result.used + width > room) return result
          return { used: result.used + width, list: [...result.list, { key: hint[1], label: hint[2] }] }
        },
        { used: 0, list: [] },
      ).list
  })

  const strip = createMemo(() => {
    const count = Math.max(1, Math.floor((dimensions().width - 2 + 1) / (TILE_WIDTH + 1)))
    const start = Math.max(0, Math.min(items.length - count, index() - Math.floor(count / 2)))
    return items.slice(start, start + count)
  })

  function failVideo(message: string) {
    // A video that fails to open with sound may still open without it, e.g. with no audio device.
    const video = player()
    if (audio() && video && !video.ready) {
      setAudio(false)
      video.play()
      return
    }
    setError({ title: "Can't play this video", detail: message, hint: true })
  }

  function VideoStage(stageProps: { item: MediaItem }) {
    const file = createVideoFile(() => stageProps.item)
    createEffect(() => {
      if (file().failed) setError({ title: "Couldn't load this video", detail: "No source could supply its bytes." })
    })
    return (
      <Show when={file().path}>
        {(source) => (
          <video
            ref={setPlayer}
            audio={audio()}
            source={source()}
            muted={muted()}
            volume={volume()}
            loop={loop()}
            fit="fit"
            crop={layout()?.crop}
            width="100%"
            height="100%"
            onReady={(metadata) => {
              setFacts(metadata)
              const playback: MediaPlayback = initial ? props.request : {}
              initial = false
              const video = player()
              if (!video) return
              if (playback.time) video.seek(Math.min(metadata.duration, playback.time))
              if (playback.playing === false) video.pause()
              else video.play()
              setTime(video.currentTime)
            }}
            onError={(cause) => failVideo(cause.message)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnd={() => setPlaying(player()?.playing ?? false)}
            onTimeUpdate={(value) => {
              setTime(value)
              setTier(player()?.qualityTier ?? 0)
            }}
          />
        )}
      </Show>
    )
  }

  function ImageStage(stageProps: { item: MediaItem }) {
    const source = createImageSource(() => stageProps.item)
    createEffect(() => {
      if (source.failed()) setError({ title: "Couldn't load this image" })
    })
    return (
      <image
        source={source.source()}
        fit="fit"
        crop={layout()?.crop}
        protocol="auto"
        width="100%"
        height="100%"
        onLoad={(image) => setFacts({ width: image.width, height: image.height })}
        onError={source.onError}
      />
    )
  }

  const infoRows = () => {
    const value = facts()
    const item = current()
    const area = layout()
    const sound = () => {
      if (!value.hasAudio) return "none"
      if (!audio()) return remote ? "off in a remote session" : "unavailable"
      return muted() ? "muted" : `on · ${Math.round(volume() * 100)}%`
    }
    return [
      ["file", item.name ?? item.id],
      ["type", item.mime || item.kind],
      ["size", size() ?? "…"],
      ...(isVideo()
        ? [
            ["fps", fps() ?? "…"],
            ["duration", duration() ?? "…"],
            ["audio", sound()],
            ["quality", tier() === 0 ? "tier 0 · full size" : `tier ${tier()} · reduced to keep up`],
          ]
        : []),
      ["protocol", media.capabilities().protocol],
      [
        "zoom",
        area && zoomed()
          ? `${percent()} · ${area.crop.width}×${area.crop.height} at ${area.crop.left},${area.crop.top}`
          : "fit",
      ],
    ] as const
  }

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
      <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} gap={2}>
        <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1} selectable={false}>
          {current().name ?? current().kind}
        </text>
        <Show when={items.length > 1}>
          <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
            {`${index() + 1} / ${items.length}`}
          </text>
        </Show>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
          {header()}
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
          if (event.button !== 0) return
          drag = { x: event.x, y: event.y, view: layout()?.view ?? { zoom: 1, x: 0, y: 0 }, moved: false }
        }}
        onMouseDrag={(event: MouseEvent) => {
          const value = geometry()
          if (!drag || !value) return
          const dx = event.x - drag.x
          const dy = event.y - drag.y
          if (dx !== 0 || dy !== 0) drag.moved = true
          if (drag.view.zoom > 1) setView(panBy(value, drag.view, dx, dy))
        }}
        onMouseUp={(event: MouseEvent) => {
          const pressed = drag
          drag = undefined
          if (event.button !== 0 || !pressed || pressed.moved) return
          if (isVideo()) togglePlay()
        }}
        onMouseScroll={(event: MouseEvent) => {
          const value = geometry()
          const direction = event.scroll?.direction
          if (!value || (direction !== "up" && direction !== "down")) return
          event.stopPropagation()
          setView(
            zoomAt(value, layout()!.view, direction === "up" ? WHEEL_STEP : 1 / WHEEL_STEP, {
              x: event.x - (stageBox?.x ?? 0),
              y: event.y - (stageBox?.y ?? 0),
            }),
          )
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
              <text fg={theme.text.feedback.error.base}>{value().title}</text>
              <Show when={value().detail}>
                <text fg={theme.text.muted} wrapMode="word">
                  {value().detail}
                </text>
              </Show>
              <Show when={value().hint}>
                <text fg={theme.text.muted} wrapMode="word">
                  {PLAYABLE_HINT}
                </text>
              </Show>
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
                  <span style={{ fg: theme.text.muted }}>{row[0].padEnd(10)}</span>
                  <span style={{ fg: theme.text.base }}>{row[1]}</span>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
      <Show when={isVideo() && !failure() && facts().duration !== undefined}>
        <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
          <text fg={theme.text.base} flexShrink={0} selectable={false} onMouseUp={togglePlay}>
            {playing() ? "⏸" : "▶"}
          </text>
          <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
            {`${formatTimecode(time())} / ${formatDuration(facts().duration ?? 0)}`}
          </text>
          <SeekBar
            duration={facts().duration ?? 0}
            time={time()}
            preview={player()?.source}
            aspect={facts().width && facts().height ? facts().width! / facts().height! : undefined}
            cellAspect={media.cellAspect()}
            onSeekStart={() => {
              resume = player()?.playing ?? false
              player()?.pause()
            }}
            onSeek={(target) => {
              seek(target)
              setTime(target)
            }}
            onSeekEnd={() => {
              if (resume) player()?.play()
              resume = false
            }}
          />
          <Toggle
            on={facts().hasAudio === true && audio() && !muted()}
            label={facts().hasAudio ? (muted() || !audio() ? "♪ off" : `♪ ${Math.round(volume() * 100)}%`) : "no audio"}
            onToggle={() => setMuted((value) => !value)}
          />
          <Toggle on={loop()} label="loop" onToggle={() => setLoop((value) => !value)} />
        </box>
      </Show>
      <Show when={filmstrip()}>
        <box
          id="media-viewer-filmstrip"
          height={TILE_HEIGHT + 2}
          flexShrink={0}
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
      <box
        id="media-viewer-footer"
        height={1}
        flexShrink={0}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        gap={2}
      >
        <For each={hints()}>
          {(hint) => (
            <text wrapMode="none" flexShrink={0} selectable={false}>
              <span style={{ fg: theme.text.base }}>{hint.key}</span>
              <span style={{ fg: theme.text.muted }}>{` ${hint.label}`}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

function unsupported(item: MediaItem): Failure | undefined {
  if (item.kind === "other") return { title: "No preview for this file", detail: item.mime || undefined }
  if (item.kind === "video" && !isPlayableVideo(item))
    return { title: `Can't play ${item.mime || "this video"}`, hint: true }
  return undefined
}

function Toggle(props: { on: boolean; label: string; onToggle: () => void }) {
  const theme = useTheme()
  const color = (): RGBA => (props.on ? theme.text.formfield.selected : theme.text.muted)
  return (
    <text fg={color()} wrapMode="none" flexShrink={0} selectable={false} onMouseUp={props.onToggle}>
      {props.label}
    </text>
  )
}

// A theme that follows the terminal's background leaves it transparent, which would show the screen underneath.
function opaque(color: RGBA) {
  return color.a === 1 ? color : RGBA.fromValues(color.r, color.g, color.b, 1)
}

function formatFps(fps: number) {
  const rounded = Math.round(fps * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}
