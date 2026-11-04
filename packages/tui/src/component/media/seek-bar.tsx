import type { BoxRenderable, MouseEvent, VideoMetadata, VideoRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show, type JSX } from "solid-js"
import { useMedia, type MediaPlayback } from "../../context/media"
import { useTheme } from "../../context/theme"
import { formatDuration, isMediaClick } from "./tile"

export type Transport = ReturnType<typeof createTransport>

/** Playback state and controls for one `<video>`, which spreads `events`. `start` applies each time it opens. */
export function createTransport(start: MediaPlayback) {
  const [player, setPlayer] = createSignal<VideoRenderable>()
  const [metadata, setMetadata] = createSignal<VideoMetadata>()
  const [time, setTime] = createSignal(start.time ?? 0)
  const [playing, setPlaying] = createSignal(false)
  const [tier, setTier] = createSignal(0)
  return {
    player,
    metadata,
    time,
    playing,
    /** OpenTUI's quality tier on Kitty: 0 is full size; higher tiers shrink frames to keep up. */
    tier,
    seek(target: number) {
      const video = player()
      if (!video) return
      video.seek(Math.max(0, Math.min(video.duration, target)))
      setTime(video.currentTime)
    },
    /** Pauses a playing video, or plays it, from the start once it has reached the end. */
    toggle() {
      const video = player()
      if (!video) return
      if (video.playing) return video.pause()
      if (video.ended || video.currentTime >= video.duration) video.seek(0)
      video.play()
    },
    events: {
      ref: setPlayer,
      // The metadata comes last, so what tracks it sees the start time and state applied.
      onReady(value: VideoMetadata) {
        const video = player()!
        if (start.time) video.seek(Math.min(value.duration, start.time))
        if (start.playing === false) video.pause()
        else video.play()
        setTime(video.currentTime)
        setMetadata(value)
      },
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnd: () => setPlaying(player()?.playing ?? false),
      onTimeUpdate(value: number) {
        setTime(value)
        setTier(player()?.qualityTier ?? 0)
      },
    },
  }
}

/** The play button, the elapsed time (with `total`, also the duration) and the seek bar of a transport row. */
export function TransportControls(props: { transport: Transport; total?: boolean; preview?: boolean }) {
  const theme = useTheme()
  const time = () => formatTimecode(props.transport.time())
  return (
    <>
      <Toggle id="media-play" on={props.transport.playing()} run={props.transport.toggle}>
        {props.transport.playing() ? "⏸" : "▶"}
      </Toggle>
      <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
        {props.total ? `${time()} / ${formatDuration(props.transport.metadata()?.duration ?? 0)}` : time()}
      </text>
      <SeekBar transport={props.transport} preview={props.preview} />
    </>
  )
}

/** A clickable control, highlighted while `on`. */
export function Toggle(props: { id?: string; on: boolean; run: () => void; children: JSX.Element }) {
  const theme = useTheme()
  const renderer = useRenderer()
  return (
    <text
      id={props.id}
      fg={props.on ? theme.text.formfield.selected : theme.text.muted}
      wrapMode="none"
      flexShrink={0}
      selectable={false}
      onMouseUp={(event: MouseEvent) => isMediaClick(renderer, event) && props.run()}
    >
      {props.children}
    </text>
  )
}

/** A paused seek decodes on the JS thread, so scrubbing and the hover preview seek at most this often. */
const SCRUB_INTERVAL_MS = 30

/**
 * A one-row slider over the video: the elapsed part fills up to the playhead, a click seeks, and a drag scrubs with
 * playback paused. With `preview`, hovering shows the frame at the pointer and its timecode above the bar.
 */
function SeekBar(props: { transport: Transport; preview?: boolean }) {
  const theme = useTheme()
  const [width, setWidth] = createSignal(0)
  const [hover, setHover] = createSignal<number>()
  const [scrubbing, setScrubbing] = createSignal(false)
  const duration = () => props.transport.metadata()?.duration ?? 0
  const seek = createThrottle(props.transport.seek)
  let bar: BoxRenderable | undefined
  let resume = false

  const column = (event: MouseEvent) => Math.max(0, Math.min(width() - 1, event.x - (bar?.x ?? 0)))
  const timeAt = (value: number) => (width() > 1 ? (value / (width() - 1)) * duration() : 0)
  const track = (event: MouseEvent) => !scrubbing() && setHover(event.y === bar?.y ? column(event) : undefined)
  const scrub = (event: MouseEvent) => {
    event.stopPropagation()
    setHover(column(event))
    seek.push(timeAt(column(event)))
  }
  // A few colour runs, not a span per cell, since this changes with every time update.
  const runs = createMemo(() => {
    if (width() < 1) return []
    const head =
      duration() > 0 ? Math.round((Math.min(duration(), props.transport.time()) / duration()) * (width() - 1)) : 0
    const marker = scrubbing() ? undefined : hover()
    const formfield = theme.text.formfield
    const segments = [
      { cell: "━", fg: formfield.selected, from: 0, to: head },
      { cell: "●", fg: scrubbing() ? formfield.pressed : formfield.focused, from: head, to: head + 1 },
      { cell: "─", fg: formfield.base, from: head + 1, to: width() },
    ]
    // The hover marker takes one cell of the fill or the track.
    return segments.flatMap((segment) => {
      const run = (from: number, to: number) => ({ text: segment.cell.repeat(to - from), fg: segment.fg })
      if (marker === undefined || marker === head || marker < segment.from || marker >= segment.to)
        return [run(segment.from, segment.to)]
      return [run(segment.from, marker), { text: "│", fg: formfield.hovered }, run(marker + 1, segment.to)]
    })
  })

  return (
    <box
      ref={(element: BoxRenderable) => (bar = element)}
      height={1}
      flexGrow={1}
      minWidth={4}
      position="relative"
      onSizeChange={function (this: BoxRenderable) {
        setWidth(this.width)
      }}
      onMouseDown={(event: MouseEvent) => {
        const video = props.transport.player()
        if (event.button !== 0 || !video || duration() <= 0) return
        resume = video.playing
        video.pause()
        setScrubbing(true)
        seek.cancel()
        scrub(event)
      }}
      onMouseDrag={(event: MouseEvent) => scrubbing() && scrub(event)}
      onMouseUp={(event: MouseEvent) => {
        if (!scrubbing()) return
        event.stopPropagation()
        setScrubbing(false)
        seek.cancel()
        props.transport.seek(timeAt(hover() ?? 0))
        if (resume) props.transport.player()?.play()
        if (event.y !== bar?.y) setHover(undefined)
      }}
      onMouseMove={track}
      onMouseOver={track}
      onMouseOut={() => !scrubbing() && setHover(undefined)}
    >
      <text wrapMode="none" selectable={false}>
        <Index each={runs()}>{(run) => <span style={{ fg: run().fg }}>{run().text}</span>}</Index>
      </text>
      <Show when={props.preview && props.transport.player()?.source && duration() > 0 && hover() !== undefined}>
        <SeekPreview
          source={props.transport.player()!.source!}
          time={timeAt(hover()!)}
          column={hover()!}
          barWidth={width()}
          aspect={(props.transport.metadata()?.width ?? 16) / (props.transport.metadata()?.height || 9)}
        />
      </Show>
    </box>
  )
}

/** The frame and timecode at the hovered time, in a second silent, paused player of the same file. */
function SeekPreview(props: { source: string; time: number; column: number; barWidth: number; aspect: number }) {
  const media = useMedia()
  const theme = useTheme()
  let player: VideoRenderable | undefined
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const width = () => Math.max(12, Math.min(28, props.barWidth))
  const height = () => Math.max(3, Math.min(10, Math.round((width() - 2) / (props.aspect * media.cellAspect()))))
  const seek = createThrottle((time) => player?.seek(time))
  createEffect(() => ready() && seek.push(props.time))

  return (
    <box
      id="media-seek-preview"
      position="absolute"
      bottom={1}
      left={Math.max(0, Math.min(props.barWidth - width(), props.column - Math.floor(width() / 2)))}
      width={width()}
      zIndex={10}
      flexDirection="column"
      alignItems="center"
      border
      borderColor={theme.border.base}
      backgroundColor={theme.background.raised.base}
    >
      <Show when={!failed()} fallback={<text fg={theme.text.muted}>no preview</text>}>
        <video
          ref={(element: VideoRenderable) => (player = element)}
          audio={false}
          source={props.source}
          fit="fit"
          width="100%"
          height={height()}
          onReady={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      </Show>
      <text fg={theme.text.base} wrapMode="none" selectable={false}>
        {formatTimecode(props.time)}
      </text>
    </box>
  )
}

/** Elapsed time as `m:ss`, counting only whole seconds that have passed. */
export function formatTimecode(seconds: number) {
  return formatDuration(Math.floor(Math.max(0, seconds)))
}

/** Calls `run` with the latest value at most once per SCRUB_INTERVAL_MS, leading and trailing. */
function createThrottle(run: (time: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: number | undefined
  const flush = () => {
    timer = undefined
    if (pending === undefined) return
    run(pending)
    pending = undefined
    timer = setTimeout(flush, SCRUB_INTERVAL_MS)
  }
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = undefined
  }
  onCleanup(cancel)
  return {
    push(time: number) {
      pending = time
      if (!timer) flush()
    },
    cancel,
  }
}
