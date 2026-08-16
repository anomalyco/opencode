import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Accessor } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerOpencodeSpinner } from "./register-spinner"

registerOpencodeSpinner()

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
export const SPINNER_ATTENTION_OFFSETS = [-1, 1, -1, 1, 0] as const
export const SPINNER_ATTENTION_STEP_MS = 60

export type SpinnerAttentionScheduler = {
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

const scheduler: SpinnerAttentionScheduler = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createSpinnerAttentionFrame(
  attention: Accessor<number | undefined>,
  clock: SpinnerAttentionScheduler = scheduler,
) {
  const [frame, setFrame] = createSignal<number>()
  let timers: unknown[] = []

  function clear() {
    timers.forEach((timer) => clock.clearTimeout(timer))
    timers = []
  }

  createEffect(
    on(
      attention,
      (value) => {
        clear()
        setFrame(undefined)
        if (value === undefined) return
        setFrame(0)
        timers = SPINNER_ATTENTION_OFFSETS.slice(1).map((_, index) => {
          const next = index + 1
          return clock.setTimeout(
            () => setFrame(next === SPINNER_ATTENTION_OFFSETS.length - 1 ? undefined : next),
            next * SPINNER_ATTENTION_STEP_MS,
          )
        })
      },
      { defer: true },
    ),
  )

  onCleanup(clear)
  return frame
}

export function resolveSpinnerAttention(frame: number | undefined, animationsEnabled: boolean) {
  if (frame === undefined) return { left: 0, emphasized: false }
  if (!animationsEnabled) return { left: 0, emphasized: true }
  return {
    left: SPINNER_ATTENTION_OFFSETS[frame] ?? 0,
    emphasized: false,
  }
}

export function Spinner(props: { children?: JSX.Element; color?: RGBA; attention?: number }) {
  const { theme } = useTheme()
  const kv = useKV()
  const animationsEnabled = () => kv.get("animations_enabled", true)
  const frame = createSpinnerAttentionFrame(() => props.attention)
  const visual = createMemo(() => resolveSpinnerAttention(frame(), animationsEnabled()))
  const color = () => (visual().emphasized ? theme.text : (props.color ?? theme.textMuted))
  const content = () => (
    <Show when={animationsEnabled()} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box
        flexDirection="row"
        gap={1}
        position={props.attention === undefined ? undefined : "relative"}
        left={props.attention === undefined ? undefined : visual().left}
      >
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )

  return content()
}
