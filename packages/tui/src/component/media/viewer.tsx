import {
  CliRenderEvents,
  RGBA,
  TextAttributes,
  type BoxRenderable,
  type MouseEvent,
  type Renderable,
  type TimerHandle,
} from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { useNewDesigns } from "../../config"
import { Keymap } from "../../context/keymap"
import { MEDIA_VIEWER_Z_INDEX, registerMediaViews, useMedia, type MediaViewerRequest } from "../../context/media"
import { useTuiTerminalEnvironment } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { usePathActions } from "../../ui/working-directory-actions"
import { Locale } from "../../util/locale"
import path from "node:path"
import { isPlayableVideo, mediaName, mediaPath, type MediaItem } from "./model"
import { MediaPip } from "./pip"
import { Control, createTransport, TransportControls } from "./seek-bar"
import { createImageSource, createVideoFile } from "./source"
import { createMediaClick, formatDuration, TileImage } from "./tile"
import { actualZoom, fillZoom, initialView, layoutView, panBy, zoomAt, type Size, type ZoomView } from "./zoom"

registerMediaViews({ viewer: MediaViewer, pip: MediaPip })

const CARD_HEIGHT = 4
const CARD_GAP = 2
/** How long a message such as "Volume 80%" stays on the picture. */
const OSD_MS = 1_200
const PLAYABLE_HINT = "The viewer plays MP4, MOV and M4V files with H.264 video and AAC audio."
const KEYS = [
  {
    title: "Playback",
    keys: [
      ["space", "Play or pause"],
      ["← →", "Seek 5 seconds"],
      ["⇧← ⇧→", "Seek 1 second"],
      [", .", "Step one frame"],
      ["0–9", "Jump to 0–90%"],
      ["↑ ↓", "Volume"],
      ["m", "Mute"],
      ["l", "Loop"],
    ],
  },
  {
    title: "Navigate",
    keys: [
      ["[ ]", "Previous or next"],
      ["← →", "Previous or next image"],
      ["p", "Picture-in-picture"],
      ["esc", "Close"],
    ],
  },
  {
    title: "View",
    keys: [
      ["+ -", "Zoom"],
      ["f", "Fit, fill, actual size"],
      ["r", "Reset zoom"],
      ["drag", "Pan a zoomed picture"],
      ["i", "Details"],
      ["?", "Keys"],
    ],
  },
]

/** The fullscreen viewer over a gallery, shown while `useMedia().viewer()` holds a request. */
function MediaViewer(props: { request: MediaViewerRequest }) {
  const media = useMedia()
  const dialog = useDialog()
  const keymap = Keymap.use()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const header = theme.surface("dialog")
  const newDesigns = useNewDesigns()
  const closeClick = createMediaClick(media.closeViewer)
  // The name opens a menu to copy the file's path, and to open its folder when the file is on this machine.
  const localServer = useTuiTerminalEnvironment().localServer === true
  const fileActions = usePathActions({
    title: () => mediaName(current()),
    path: () => mediaPath(current()),
    folder: () => {
      const file = mediaPath(current())
      return file && (current().path || localServer) ? path.dirname(file) : undefined
    },
  })
  const nameClick = createMediaClick(fileActions.onMouseUp)
  const items = props.request.items
  // Sound is off in a remote session, where it would play on the remote machine.
  const remote = renderer.capabilities?.remote === true

  const [index, setIndex] = createSignal(props.request.index)
  const [image, setImage] = createSignal<Size>()
  // A failure is its title and explanation lines.
  const [error, setError] = createSignal<string[]>()
  const [view, setView] = createSignal<ZoomView>()
  const [stage, setStage] = createSignal<Size>({ width: 0, height: 0 })
  const [muted, setMuted] = createSignal(props.request.muted ?? false)
  const [volume, setVolume] = createSignal(props.request.volume ?? 1)
  const [loop, setLoop] = createSignal(props.request.loop ?? false)
  const [info, setInfo] = createSignal(false)
  const [keys, setKeys] = createSignal(false)
  // The request's time and playing state apply to the item it opened at.
  let start: Partial<MediaViewerRequest> = props.request
  const transport = createMemo(on(index, () => createTransport(start)))
  let stageBox: BoxRenderable | undefined
  let keyList: BoxRenderable | undefined
  const [keyScroll, setKeyScroll] = createSignal(0)
  // The rows of the keys list that a short terminal cuts off, out of the panel's height less its border and padding.
  const scrollKeys = (rows: number) => {
    const overflow = (keyList?.height ?? 0) - (keyList?.parent?.height ?? 0) + 2 + (roomy() ? 1 : 0)
    setKeyScroll((value) => Math.max(0, Math.min(overflow, value + rows)))
  }

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
  const roomy = () => dimensions().height >= 22

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

  const [osd, setOsd] = createSignal<() => string>()
  let osdTimer: TimerHandle | undefined
  function flash(message: () => string) {
    if (osdTimer) renderer.clock.clearTimeout(osdTimer)
    osdTimer = renderer.clock.setTimeout(() => setOsd(undefined), OSD_MS)
    setOsd(() => message)
  }
  onCleanup(() => osdTimer && renderer.clock.clearTimeout(osdTimer))

  function go(next: number) {
    const target = (next + items.length) % items.length
    if (target === index()) return
    start = {}
    batch(() => {
      setIndex(target)
      setImage(undefined)
      setError(undefined)
      setView(undefined)
    })
  }

  function seek(target: number, message?: string) {
    if (!video()) return
    transport().seek(target)
    if (message) flash(() => message)
  }

  function step(frames: number) {
    const player = video()
    if (!player) return
    player.pause()
    seek((Math.round(transport().position() * fps()) + frames) / fps(), frames > 0 ? "Next frame" : "Previous frame")
  }

  function zoom(next: (value: NonNullable<ReturnType<typeof geometry>>, view: ZoomView) => ZoomView, label?: string) {
    const value = geometry()
    if (!value) return
    setView(next(value, layout()!.view))
    flash(() => label ?? (zoomed() ? `Zoom ${percent()}` : "Fit"))
  }

  function arrow(dx: number, dy: number) {
    if (keys() && dy !== 0) return scrollKeys(dy)
    if (current().kind === "image" && !zoomed()) return dx === 0 ? undefined : go(index() + dx)
    const area = stage()
    if (current().kind === "image") {
      const value = geometry()
      return (
        value &&
        setView(panBy(value, layout()!.view, -dx * Math.ceil(area.width / 8), -dy * Math.ceil(area.height / 8)))
      )
    }
    if (dx !== 0) return seek(transport().position() + dx * 5, dx > 0 ? "+5s" : "−5s")
    if (!video()) return
    setVolume((value) => Math.round(Math.max(0, Math.min(1, value - dy * 0.1)) * 10) / 10)
    flash(() => `Volume ${Math.round(volume() * 100)}%`)
  }

  function pip() {
    const player = video()
    if (!player) return
    const playback = {
      time: transport().position(),
      playing: player.playing,
      muted: muted(),
      volume: volume(),
      loop: loop(),
    }
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

  const toggleMute = () => {
    setMuted((value) => !value)
    flash(() => (muted() ? "Muted" : `Volume ${Math.round(volume() * 100)}%`))
  }
  const toggleLoop = () => {
    setLoop((value) => !value)
    flash(() => (loop() ? "Loop on" : "Loop off"))
  }
  const command = (bind: string, title: string, run: () => void) => ({ bind, title, group: "Media", run })
  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: dialog.stack.length === 0,
    commands: [
      command("escape,q,ctrl+c", "Close keys, details or viewer", () => {
        if (keys() || info()) return batch(() => (setKeys(false), setInfo(false)))
        media.closeViewer()
      }),
      command("[,pageup", "Previous item", () => go(index() - 1)),
      command("],pagedown", "Next item", () => go(index() + 1)),
      command("left", "Previous image, pan or seek back", () => arrow(-1, 0)),
      command("right", "Next image, pan or seek forward", () => arrow(1, 0)),
      command("up", "Pan up or volume up", () => arrow(0, -1)),
      command("down", "Pan down or volume down", () => arrow(0, 1)),
      command("shift+left", "Seek back 1s", () => seek(transport().position() - 1, "−1s")),
      command("shift+right", "Seek forward 1s", () => seek(transport().position() + 1, "+1s")),
      command("space", "Play or pause", () => video() && transport().toggle()),
      command(".", "Next frame", () => step(1)),
      ...Array.from({ length: 10 }, (_, digit) =>
        command(String(digit), `Go to ${digit * 10}%`, () => seek((length() * digit) / 10)),
      ),
      command("m", "Mute", toggleMute),
      command("l", "Loop", toggleLoop),
      command("+,=", "Zoom in", () => zoom((value, view) => zoomAt(value, view, 1.5))),
      command("-", "Zoom out", () => zoom((value, view) => zoomAt(value, view, 1 / 1.5))),
      command("r", "Reset zoom", () => zoom(() => initialView(geometry()!.source), "Fit")),
      command("f", "Cycle fit, fill and actual size", () => {
        const value = geometry()
        if (!value) return
        const fill = fillZoom(value)
        const actual = actualZoom(value, media.cellPixels())
        const target = [fill, actual].sort((a, b) => a - b).find((target) => target > layout()!.view.zoom + 1e-3) ?? 1
        zoom((_, view) => ({ ...view, zoom: target }), target === 1 ? "Fit" : target === fill ? "Fill" : "Actual size")
      }),
      command("i", "Media details", () => setInfo((value) => !value)),
      command("?,shift+?,shift+/", "Keys", () => {
        setKeyScroll(0)
        setKeys((value) => !value)
      }),
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

  createEffect(() => metadata() && media.noteDuration(current(), metadata()!.duration))

  const size = () => facts() && `${facts()!.width}×${facts()!.height}`
  const audible = () => !!metadata()?.hasAudio && !remote

  const filmstrip = () => items.length > 1 && dimensions().height >= 24
  // Cards share the width evenly, within bounds, and the window keeps the current item near its middle.
  const strip = createMemo(() => {
    const room = dimensions().width - 4 + CARD_GAP
    const width = Math.max(12, Math.min(18, Math.floor(room / items.length) - CARD_GAP))
    const count = Math.max(1, Math.min(items.length, Math.floor(room / (width + CARD_GAP))))
    const first = Math.max(0, Math.min(items.length - count, index() - Math.floor(count / 2)))
    return { width, items: items.slice(first, first + count) }
  })

  // OpenTUI reports the Kitty file transport's state without an event, and its probe or a fallback changes it, so read
  // it again every second while the details show.
  const [fileState, setFileState] = createSignal(renderer.kittyImageTransportStatus.fileState)
  createEffect(() => {
    if (!info()) return
    const read = () => setFileState(renderer.kittyImageTransportStatus.fileState)
    read()
    const timer = renderer.clock.setInterval(read, 1_000)
    onCleanup(() => renderer.clock.clearInterval(timer))
  })

  const infoRows = () => {
    const item = current()
    const area = layout()
    const bytes = item.path ? Bun.file(item.path).size : 0
    const rows = [
      ["Name", mediaName(item)],
      ["Type", item.mime || item.kind],
      ["Resolution", size() || "…"],
      item.kind === "video" && ["Duration", metadata() ? formatDuration(metadata()!.duration) : "…"],
      item.kind === "video" && ["Frame rate", metadata()?.fps ? `${+metadata()!.fps.toFixed(2)} fps` : "…"],
      item.kind === "video" && [
        "Sound",
        !metadata()?.hasAudio
          ? "none"
          : remote
            ? "off in a remote session"
            : muted()
              ? "muted"
              : `${Math.round(volume() * 100)}%`,
      ],
      item.kind === "video" && [
        "Quality",
        transport().tier() ? `reduced to keep up (tier ${transport().tier()})` : "full size",
      ],
      bytes > 0 && ["Size", bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} KB`],
      [
        "Protocol",
        media.protocol() === "kitty"
          ? `kitty · ${fileState() === "ready" ? "file" : fileState() === "probing" ? "probing" : "raw"}`
          : media.protocol(),
      ],
      [
        "Zoom",
        area && zoomed()
          ? `${percent()} · ${area.crop.width}×${area.crop.height} at ${area.crop.left},${area.crop.top}`
          : "fit",
      ],
      mediaPath(item) && ["Path", Locale.truncateMiddle(mediaPath(item)!, 40)],
    ]
    return rows.filter((row): row is string[] => Array.isArray(row))
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
            audio={!remote}
            source={source()}
            muted={muted()}
            volume={volume()}
            loop={loop()}
            fit="fit"
            crop={layout()?.crop}
            width="100%"
            height="100%"
            {...transport().events}
            onError={(cause) => setError(["Can't play this video", cause.message, PLAYABLE_HINT])}
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
      {/* The image preview dialog's header, whose esc ignores the release of a drag or selection over it. */}
      <box
        marginTop={roomy() ? 1 : 0}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        justifyContent="space-between"
        gap={2}
      >
        <text
          attributes={
            (newDesigns() ? TextAttributes.NONE : TextAttributes.BOLD) |
            (fileActions.hovered() && mediaPath(current()) ? TextAttributes.UNDERLINE : TextAttributes.NONE)
          }
          fg={header.text.base}
          wrapMode="none"
          truncate
          flexShrink={1}
          selectable={false}
          onMouseOver={fileActions.onMouseOver}
          onMouseOut={fileActions.onMouseOut}
          {...nameClick}
        >
          {mediaName(current())}
        </text>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={header.text.muted} selectable={false}>
            {`${index() + 1} of ${items.length}`}
          </text>
          <text fg={header.text.muted} selectable={false} {...closeClick}>
            esc
          </text>
        </box>
      </box>
      <box
        id="media-viewer-stage"
        ref={(element: BoxRenderable) => (stageBox = element)}
        flexGrow={1}
        minHeight={1}
        marginTop={roomy() ? 1 : 0}
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
            <box width="100%" height="100%" alignItems="center" justifyContent="center" padding={1}>
              <box
                id="media-viewer-failure"
                maxWidth={64}
                border
                borderStyle="rounded"
                borderColor={theme.border.base}
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                flexDirection="column"
                gap={1}
              >
                <For each={value()}>
                  {(line, index) => (
                    <text fg={index() === 0 ? theme.text.feedback.error.base : theme.text.muted} wrapMode="word">
                      {line}
                    </text>
                  )}
                </For>
              </box>
            </box>
          )}
        </Show>
        <Show when={osd()}>
          {(message) => (
            <box
              position="absolute"
              top={1}
              left={0}
              width="100%"
              zIndex={6}
              flexDirection="row"
              justifyContent="center"
            >
              <box
                id="media-viewer-osd"
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={theme.background.raised.high}
              >
                <text fg={theme.text.base} wrapMode="none" selectable={false}>
                  {message()()}
                </text>
              </box>
            </box>
          )}
        </Show>
        <Show when={info()}>
          <box
            id="media-viewer-info"
            position="absolute"
            top={0}
            right={2}
            zIndex={5}
            border
            borderStyle="rounded"
            borderColor={theme.border.base}
            title=" Details "
            titleColor={theme.text.base}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
            backgroundColor={theme.background.raised.base}
          >
            <For each={infoRows()}>
              {(row) => (
                <text wrapMode="none" selectable={false}>
                  <span style={{ fg: theme.text.muted }}>{row[0]!.padEnd(12)}</span>
                  <span style={{ fg: theme.text.base }}>{row[1]}</span>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
      <box id="media-viewer-controls" flexShrink={0} paddingBottom={roomy() ? 1 : 0}>
        <Show when={playable()}>
          <box height={1} marginTop={roomy() ? 1 : 0} paddingLeft={2} paddingRight={2}>
            <Show when={transport().metadata()}>
              <TransportControls transport={transport()} gap={2} preview>
                <Show when={audible()}>
                  <Control on={!muted()} struck={muted()} run={toggleMute}>
                    ♪
                  </Control>
                </Show>
                <Control on={loop()} run={toggleLoop}>
                  ↻
                </Control>
              </TransportControls>
            </Show>
          </box>
        </Show>
        <Show when={filmstrip()}>
          <box
            id="media-viewer-filmstrip"
            height={CARD_HEIGHT + 1}
            marginTop={1}
            flexDirection="row"
            justifyContent="center"
            gap={CARD_GAP}
          >
            <For each={strip().items}>
              {(item) => (
                <Card
                  item={item}
                  width={strip().width}
                  current={items.indexOf(item) === index()}
                  onOpen={() => go(items.indexOf(item))}
                />
              )}
            </For>
          </box>
        </Show>
      </box>
      <Show when={keys()}>
        <box
          position="absolute"
          left={0}
          top={0}
          width="100%"
          height="100%"
          zIndex={10}
          alignItems="center"
          justifyContent="center"
        >
          <box
            id="media-viewer-keys"
            maxWidth={dimensions().width - 2}
            maxHeight={dimensions().height - 2}
            overflow="hidden"
            onMouseScroll={(event: MouseEvent) => scrollKeys(event.scroll?.direction === "up" ? -1 : 1)}
            border
            borderStyle="rounded"
            borderColor={theme.border.base}
            title=" Keys "
            titleColor={theme.text.base}
            backgroundColor={theme.background.raised.base}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={roomy() ? 1 : 0}
          >
            {/* A short terminal scrolls the list with the up and down keys or the wheel. */}
            <box
              ref={(element: BoxRenderable) => (keyList = element)}
              marginTop={-keyScroll()}
              flexShrink={0}
              flexDirection="row"
              flexWrap="wrap"
              columnGap={4}
            >
              <For each={KEYS}>
                {(group) => (
                  <box flexDirection="column" paddingBottom={1}>
                    <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>
                      {group.title}
                    </text>
                    <For each={group.keys}>
                      {(key) => (
                        <text wrapMode="none" selectable={false}>
                          <span style={{ fg: theme.text.base }}>{key[0]!.padEnd(7)}</span>
                          <span style={{ fg: theme.text.muted }}>{key[1]}</span>
                        </text>
                      )}
                    </For>
                  </box>
                )}
              </For>
            </box>
          </box>
        </box>
      </Show>
    </box>
  )
}

/**
 * A filmstrip card: an image's thumbnail, or for a video a play mark and its duration once a player has read it, with
 * the name under it. The current item has a heavy border in the accent.
 */
function Card(props: { item: MediaItem; width: number; current: boolean; onOpen: () => void }) {
  const media = useMedia()
  const theme = useTheme()
  const click = createMediaClick(() => props.onOpen())
  const [hovered, setHovered] = createSignal(false)
  const formfield = theme.text.formfield
  const duration = () => media.duration(props.item)
  return (
    <box width={props.width} flexShrink={0} flexDirection="column">
      <box
        height={CARD_HEIGHT}
        border
        borderStyle={props.current ? "heavy" : "rounded"}
        borderColor={props.current ? formfield.selected : hovered() ? formfield.hovered : theme.border.base}
        alignItems="center"
        justifyContent="center"
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        {...click}
      >
        <Switch>
          <Match when={props.item.kind === "image"}>
            <TileImage item={props.item} />
          </Match>
          <Match when={props.item.kind === "video"}>
            <text fg={isPlayableVideo(props.item) ? theme.text.base : theme.text.muted} selectable={false}>
              ▶
            </text>
            <Show when={duration() !== undefined}>
              <text fg={theme.text.muted} selectable={false}>
                {formatDuration(duration()!)}
              </text>
            </Show>
          </Match>
        </Switch>
      </box>
      <text
        fg={props.current ? theme.text.base : theme.text.muted}
        alignSelf="center"
        wrapMode="none"
        selectable={false}
      >
        {Locale.truncateMiddle(mediaName(props.item), props.width)}
      </text>
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
