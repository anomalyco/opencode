import type { BoxRenderable, MouseEvent, RGBA, VideoRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { formatDuration } from "./tile"

/** A paused seek decodes on the JS thread, so scrubbing and the hover preview seek at most this often. */
const SCRUB_INTERVAL_MS = 30

/**
 * A one-row slider over a video's duration: the elapsed part fills up to the playhead, a click seeks, and a drag
 * scrubs. With `preview`, hovering shows that file's frame at the pointer and its timecode above the bar.
 */
export function SeekBar(props: {
  duration: number
  time: number
  /** A local video file for the hover preview. */
  preview?: string
  /** The source width over its height, to size the preview. */
  aspect?: number
  cellAspect?: number
  /** A press on the bar starts scrubbing; `onSeekEnd` follows on release with the final time. */
  onSeekStart?: () => void
  onSeek: (time: number) => void
  onSeekEnd?: () => void
}) {
  const theme = useTheme()
  const [width, setWidth] = createSignal(0)
  const [hover, setHover] = createSignal<number>()
  const [scrubbing, setScrubbing] = createSignal(false)
  let bar: BoxRenderable | undefined
  let last = 0
  const seek = createThrottle(SCRUB_INTERVAL_MS, (time: number) => props.onSeek(time))

  const column = (event: MouseEvent) => Math.max(0, Math.min(width() - 1, event.x - (bar?.x ?? 0)))
  const timeAt = (value: number) => (width() > 1 ? (value / (width() - 1)) * props.duration : 0)
  const track = (event: MouseEvent) => {
    if (!scrubbing()) setHover(event.y === bar?.y ? column(event) : undefined)
  }
  const head = () =>
    props.duration > 0 && width() > 0
      ? Math.round((Math.max(0, Math.min(props.duration, props.time)) / props.duration) * (width() - 1))
      : 0

  const cells = createMemo(() => {
    const filled = theme.text.formfield.selected
    const track = theme.text.formfield.base
    const pointer = theme.text.formfield.hovered
    const playhead = scrubbing() ? theme.text.formfield.pressed : theme.text.formfield.focused
    const marker = scrubbing() ? undefined : hover()
    return runs(
      Array.from({ length: width() }, (_, index): [string, RGBA] => {
        if (index === head()) return ["●", playhead]
        if (index === marker) return ["│", pointer]
        if (index < head()) return ["━", filled]
        return ["─", track]
      }),
    )
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
        if (event.button !== 0 || props.duration <= 0) return
        event.stopPropagation()
        setScrubbing(true)
        props.onSeekStart?.()
        last = column(event)
        setHover(last)
        seek.now(timeAt(last))
      }}
      onMouseDrag={(event: MouseEvent) => {
        if (!scrubbing()) return
        event.stopPropagation()
        last = column(event)
        setHover(last)
        seek.push(timeAt(last))
      }}
      onMouseUp={(event: MouseEvent) => {
        if (!scrubbing()) return
        event.stopPropagation()
        setScrubbing(false)
        seek.cancel()
        props.onSeek(timeAt(last))
        props.onSeekEnd?.()
        if (event.y !== bar?.y) setHover(undefined)
      }}
      onMouseMove={track}
      onMouseOver={track}
      onMouseOut={() => {
        if (!scrubbing()) setHover(undefined)
      }}
    >
      <text wrapMode="none" selectable={false}>
        <For each={cells()}>{(run) => <span style={{ fg: run.fg }}>{run.text}</span>}</For>
      </text>
      <Show when={props.preview && props.duration > 0 && hover() !== undefined}>
        <SeekPreview
          source={props.preview!}
          time={timeAt(hover()!)}
          column={hover()!}
          barWidth={width()}
          aspect={props.aspect ?? 16 / 9}
          cellAspect={props.cellAspect ?? 2}
        />
      </Show>
    </box>
  )
}

/** The frame and timecode at the hovered time, in a second silent, paused player of the same file. */
function SeekPreview(props: {
  source: string
  time: number
  column: number
  barWidth: number
  aspect: number
  cellAspect: number
}) {
  const theme = useTheme()
  const [player, setPlayer] = createSignal<VideoRenderable>()
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const width = () => Math.max(12, Math.min(28, props.barWidth))
  const height = () => Math.max(3, Math.min(10, Math.round((width() - 2) / (props.aspect * props.cellAspect))))
  const seek = createThrottle(SCRUB_INTERVAL_MS, (time: number) => player()?.seek(time))

  createEffect(() => {
    const time = props.time
    if (ready()) seek.push(time)
  })

  return (
    <box
      id="media-seek-preview"
      position="absolute"
      bottom={1}
      left={Math.max(0, Math.min(props.barWidth - width(), props.column - Math.floor(width() / 2)))}
      width={width()}
      zIndex={10}
      flexDirection="column"
      border
      borderColor={theme.border.base}
      backgroundColor={theme.background.raised.base}
    >
      <Show
        when={!failed()}
        fallback={
          <box height={height()} alignItems="center" justifyContent="center">
            <text fg={theme.text.muted}>no preview</text>
          </box>
        }
      >
        <video
          ref={setPlayer}
          audio={false}
          source={props.source}
          fit="fit"
          width="100%"
          height={height()}
          onReady={() => {
            player()?.seek(props.time)
            setReady(true)
          }}
          onError={() => setFailed(true)}
        />
      </Show>
      <box flexDirection="row" justifyContent="center">
        <text fg={theme.text.base} wrapMode="none" selectable={false}>
          {formatTimecode(props.time)}
        </text>
      </box>
    </box>
  )
}

/** Pauses a playing video, or plays it, from the start once it has reached the end. */
export function togglePlayback(video: VideoRenderable) {
  if (video.playing) return video.pause()
  if (video.ended || video.currentTime >= video.duration) video.seek(0)
  video.play()
}

/** Elapsed time as `m:ss`, counting only whole seconds that have passed. */
export function formatTimecode(seconds: number) {
  return formatDuration(Math.floor(Math.max(0, seconds)))
}

/**
 * Calls `run` with the latest value at most once per `interval` milliseconds, leading and trailing. `now` runs
 * immediately and restarts the interval; `cancel` drops a pending call.
 */
function createThrottle<T>(interval: number, run: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { value: T } | undefined
  let last = -Infinity

  function flush() {
    timer = undefined
    if (!pending) return
    const value = pending.value
    pending = undefined
    last = Date.now()
    run(value)
  }

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    pending = undefined
  }

  onCleanup(cancel)

  return {
    push(value: T) {
      pending = { value }
      if (timer) return
      const wait = last + interval - Date.now()
      if (wait <= 0) return flush()
      timer = setTimeout(flush, wait)
    },
    now(value: T) {
      cancel()
      pending = { value }
      flush()
    },
    cancel,
  }
}

function runs(cells: readonly [string, RGBA][]) {
  return cells.reduce<{ text: string; fg: RGBA }[]>((result, [text, fg]) => {
    const previous = result.at(-1)
    if (previous && previous.fg === fg) {
      previous.text += text
      return result
    }
    result.push({ text, fg })
    return result
  }, [])
}
