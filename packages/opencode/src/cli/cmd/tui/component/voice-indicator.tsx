import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { createColors, createFrames } from "../ui/spinner"
import type { RGBA } from "@opentui/core"

const PULSE_FRAMES = ["◉", "◎", "○", "◎"]
const PROCESSING_FRAMES = ["▌", "▐", "▌", "▐"]

export function VoiceIndicator(props: { isRecording: boolean; isProcessing: boolean; error?: string }) {
  const { theme } = useTheme()

  const recordingColor = createMemo(() => theme.error)
  const processingColor = createMemo(() => theme.primary)
  const errorColor = createMemo(() => theme.error)

  const recordingFrames = createMemo(() => createFrames({
    width: 1,
    color: recordingColor(),
    style: "diamonds",
    trailSteps: 1,
    holdStart: 5,
    holdEnd: 5,
  }))

  const processingFrames = createMemo(() => createFrames({
    width: 1,
    color: processingColor(),
    style: "diamonds",
    trailSteps: 1,
    holdStart: 3,
    holdEnd: 3,
  }))

  return (
    <Show when={props.isRecording || props.isProcessing || !!props.error}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Show when={props.isRecording}>
          <text fg={recordingColor()}>◉</text>
          <text fg={recordingColor()}>recording</text>
        </Show>
        <Show when={props.isProcessing}>
          <text fg={processingColor()}>▌</text>
          <text fg={processingColor()}>transcribing</text>
        </Show>
        <Show when={!!props.error}>
          <text fg={errorColor()}>⚠</text>
          <text fg={errorColor()}>{props.error}</text>
        </Show>
      </box>
    </Show>
  )
}
