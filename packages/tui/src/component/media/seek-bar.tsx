import {
  TextAttributes,
  type BoxRenderable,
  type Clock,
  type MouseEvent,
  type TimerHandle,
  type VideoMetadata,
  type VideoRenderable,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show, type JSX } from "solid-js"
import { useMedia, type MediaPlayback } from "../../context/media"
import { useTheme } from "../../context/theme"
import { createMediaClick, formatDuration } from "./tile"

type Transport = ReturnType<typeof createTransport>

/** Playback state and controls for one `<video>`, which spreads `events`. `start` applies each time it opens. */
export function createTransport(start: MediaPlayback) {
  const [player, setPlayer] = createSignal<VideoRenderable>()
  const [metadata, setMetadata] = createSignal<VideoMetadata>()
  const [time, setTime] = createSignal(start.time ?? 0)
  const [playing, setPlaying] = createSignal(false)
  const [tier, setTier] = createSignal(0)
  const [scrubTime, setScrubTime] = createSignal<number>()
  const seeker = createSeekThrottle(useRenderer().clock, (target) => {
    const video = player()
    if (!video) return
    video.seek(target)
    setTime(video.currentTime)
  })
  const clamp = (target: number) => Math.max(0, Math.min(player()?.duration ?? 0, target))
  return {
    player,
    metadata,
    time,
    playing,
    /** Where playback is headed: the dragged seek bar's time, a pending seek's target, or the current time. */
    position: () => scrubTime() ?? seeker.pending() ?? time(),
    /** Where the seek bar is dragged to while it is, shown ahead of the throttled seeks that follow it. */
    scrubTime,
    setScrubTime,
    /** OpenTUI's quality tier on Kitty: 0 is full size; higher tiers shrink frames to keep up. */
    tier,
    /** Seeks to `target` now, or as the throttle allows, replacing a pending seek. */
    seek: (target: number) => player() && seeker.push(clamp(target)),
    /** Seeks to `target` at once, dropping a pending seek. */
    land: (target: number) => player() && seeker.flush(clamp(target)),
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
        // Playback moves the player away from the last seek, so a seek to that time again is not a repeat.
        if (player()?.playing) seeker.reset()
      },
    },
  }
}

/**
 * A transport row: the play button, the elapsed time, the seek bar, the total time, and `children` such as toggles. The
 * total time goes before the seek bar would shrink below 10 cells.
 */
export function TransportControls(props: {
  transport: Transport
  gap: number
  preview?: boolean
  children?: JSX.Element
}) {
  const theme = useTheme()
  const [barWidth, setBarWidth] = createSignal(0)
  const total = () => formatDuration(props.transport.metadata()?.duration ?? 0)
  const showTotal = createMemo<boolean>((shown) => barWidth() >= 10 + (shown ? 0 : total().length + props.gap), false)
  return (
    <box height={1} flexDirection="row" gap={props.gap}>
      <Control id="media-play" primary run={props.transport.toggle}>
        {props.transport.playing() ? "⏸" : "▶"}
      </Control>
      <text fg={theme.text.base} wrapMode="none" flexShrink={0} selectable={false}>
        {formatTimecode(props.transport.position())}
      </text>
      <SeekBar transport={props.transport} preview={props.preview} onWidth={setBarWidth} />
      <Show when={showTotal()}>
        <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
          {total()}
        </text>
      </Show>
      {props.children}
    </box>
  )
}

/**
 * A clickable glyph: in the accent while `on`; otherwise muted, or the base colour when `primary`, and brighter while
 * hovered. `struck` crosses it out, as a muted sound is.
 */
export function Control(props: {
  id?: string
  on?: boolean
  primary?: boolean
  struck?: boolean
  run: () => void
  children: JSX.Element
}) {
  const theme = useTheme()
  const click = createMediaClick(() => props.run())
  const [hovered, setHovered] = createSignal(false)
  const action = () => theme.text.action[props.primary ? "primary" : "secondary"]
  return (
    <text
      id={props.id}
      fg={props.on ? theme.text.action.primary.selected : action().state({ hovered: hovered() })}
      attributes={props.struck ? TextAttributes.STRIKETHROUGH : undefined}
      wrapMode="none"
      flexShrink={0}
      selectable={false}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      {...click}
    >
      {props.children}
    </text>
  )
}

/** Scrubbing and the hover preview seek at most this often, or less often when seeks are slow. */
const SEEK_INTERVAL_MS = 120
/** The hover preview seeks once the pointer has rested this long. */
const PREVIEW_REST_MS = 80

/**
 * A one-row slider over the video: the elapsed part fills up to the playhead, a click seeks, and a drag scrubs with
 * playback paused. With `preview`, hovering shows the frame at the pointer and its timecode above the bar.
 */
function SeekBar(props: { transport: Transport; preview?: boolean; onWidth: (width: number) => void }) {
  const theme = useTheme()
  const [width, setWidth] = createSignal(0)
  const [hover, setHover] = createSignal<number>()
  const scrubbing = () => props.transport.scrubTime() !== undefined
  const duration = () => props.transport.metadata()?.duration ?? 0
  let bar: BoxRenderable | undefined
  let resume = false

  const column = (event: MouseEvent) => Math.max(0, Math.min(width() - 1, event.x - (bar?.x ?? 0)))
  const timeAt = (value: number) => (width() > 1 ? (value / (width() - 1)) * duration() : 0)
  const track = (event: MouseEvent) => !scrubbing() && setHover(event.y === bar?.y ? column(event) : undefined)
  const scrub = (event: MouseEvent) => {
    event.stopPropagation()
    setHover(column(event))
    props.transport.setScrubTime(timeAt(column(event)))
    props.transport.seek(timeAt(column(event)))
  }
  // The playhead's column, so the runs below change only when it moves, not with every time update.
  const head = createMemo(() => {
    const time = props.transport.position()
    return duration() > 0 ? Math.round((Math.min(duration(), time) / duration()) * (width() - 1)) : 0
  })
  // A few colour runs, not a span per cell.
  const runs = createMemo(() => {
    if (width() < 1) return []
    const marker = scrubbing() ? undefined : hover()
    const formfield = theme.text.formfield
    const segments = [
      { cell: "━", fg: formfield.selected, from: 0, to: head() },
      { cell: "●", fg: scrubbing() ? formfield.pressed : formfield.focused, from: head(), to: head() + 1 },
      { cell: "─", fg: theme.text.muted, from: head() + 1, to: width() },
    ]
    // The hover marker takes one cell of the fill or the track.
    return segments.flatMap((segment) => {
      const run = (from: number, to: number) => ({ text: segment.cell.repeat(to - from), fg: segment.fg })
      if (marker === undefined || marker === head() || marker < segment.from || marker >= segment.to)
        return [run(segment.from, segment.to)]
      return [run(segment.from, marker), { text: "│", fg: formfield.hovered }, run(marker + 1, segment.to)]
    })
  })

  return (
    <box
      ref={(element: BoxRenderable) => (bar = element)}
      height={1}
      flexGrow={1}
      flexBasis={0}
      minWidth={4}
      position="relative"
      onSizeChange={function (this: BoxRenderable) {
        setWidth(this.width)
        props.onWidth(this.width)
      }}
      onMouseDown={(event: MouseEvent) => {
        const video = props.transport.player()
        if (event.button !== 0 || !video || duration() <= 0) return
        resume = video.playing
        video.pause()
        scrub(event)
      }}
      onMouseDrag={(event: MouseEvent) => scrubbing() && scrub(event)}
      onMouseUp={(event: MouseEvent) => {
        if (!scrubbing()) return
        event.stopPropagation()
        props.transport.land(props.transport.scrubTime()!)
        props.transport.setScrubTime(undefined)
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
          scrubbing={scrubbing()}
          aspect={(props.transport.metadata()?.width ?? 16) / (props.transport.metadata()?.height || 9)}
        />
      </Show>
    </box>
  )
}

/**
 * The frame and timecode at the hovered time, in a second silent, paused player of the same file. While scrubbing,
 * the main player shows the frame, so the preview hides and does not seek.
 */
function SeekPreview(props: {
  source: string
  time: number
  column: number
  barWidth: number
  aspect: number
  scrubbing: boolean
}) {
  const media = useMedia()
  const theme = useTheme()
  let player: VideoRenderable | undefined
  // Each open, of a new source or the same one again, shows its first frame, so it seeks again even to the last time.
  const [ready, setReady] = createSignal(false, { equals: false })
  const [failed, setFailed] = createSignal(false)
  const width = () => Math.max(12, Math.min(28, props.barWidth))
  const height = () => Math.max(3, Math.min(10, Math.round((width() - 2) / (props.aspect * media.cellAspect()))))
  // After a scrub, its frame is from before the scrub until it catches up with where the scrub ended.
  const [behind, setBehind] = createSignal(false)
  const seek = createSeekThrottle(
    useRenderer().clock,
    (time) => {
      player?.seek(time)
      setBehind(false)
    },
    PREVIEW_REST_MS,
  )
  createEffect(() => {
    if (!ready()) return
    if (props.scrubbing) {
      setBehind(true)
      return seek.cancel()
    }
    if (props.time === seek.last()) setBehind(false)
    seek.push(props.time)
  })

  return (
    <box
      id="media-seek-preview"
      position="absolute"
      bottom={1}
      left={Math.max(0, Math.min(props.barWidth - width(), props.column - Math.floor(width() / 2)))}
      width={width()}
      zIndex={10}
      visible={!props.scrubbing && !behind()}
      flexDirection="column"
      alignItems="center"
      border
      borderStyle="rounded"
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
          onReady={() => {
            seek.reset()
            setReady(true)
          }}
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
function formatTimecode(seconds: number) {
  return formatDuration(Math.floor(Math.max(0, seconds)))
}

/**
 * Calls `run` with the latest value `rest` ms after the last push, and at most once per interval: SEEK_INTERVAL_MS, or
 * twice the time the last call took. A paused seek decodes on the JS thread, so slow seeks keep it at least half free.
 * It never calls `run` twice in a row with the same time, since OpenTUI decodes even an unchanged seek again.
 */
export function createSeekThrottle(clock: Clock, run: (time: number) => void, rest = 0) {
  let timer: TimerHandle | undefined
  const [pending, setPending] = createSignal<number>()
  let last: number | undefined
  let next = -Infinity
  const cancel = () => {
    if (timer) clock.clearTimeout(timer)
    timer = undefined
    setPending(undefined)
  }
  /** Calls `run` with `time` now, dropping a pending call. */
  const flush = (time: number) => {
    cancel()
    if (time === last) return
    last = time
    const started = clock.now()
    run(time)
    next = started + Math.max(SEEK_INTERVAL_MS, 2 * (clock.now() - started))
  }
  onCleanup(cancel)
  return {
    /** The time of the call waiting for its turn. */
    pending,
    last: () => last,
    push(time: number) {
      setPending(time)
      // Without a rest, a scheduled call keeps its time; with one, each push restarts the wait.
      if (timer && !rest) return
      if (timer) clock.clearTimeout(timer)
      const wait = Math.max(rest, next - clock.now())
      if (wait <= 0) return flush(time)
      timer = clock.setTimeout(() => flush(pending()!), wait)
    },
    flush,
    cancel,
    /** Forgets the last time, once something else may have moved the player. */
    reset() {
      last = undefined
    },
  }
}
