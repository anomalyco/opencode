/** @jsxImportSource @opentui/solid */
// Update preflight: a split-footer status shown while a freshly launched CLI
// replaces a version-mismatched background service before the TUI attaches.
// The footer animates in the terminal's bottom rows, writes a one-line
// receipt into scrollback, and fully destroys its renderer before the TUI
// creates its own — the receipt survives above the TUI.
import { createCliRenderer, RGBA, TextAttributes, type CliRenderer } from "@opentui/core"
import { createScrollbackWriter, render, useTerminalDimensions } from "@opentui/solid"
import { registerOpencodeSpinner } from "@opencode-ai/tui/component/register-spinner"
import { SPINNER_FRAMES } from "@opencode-ai/tui/component/spinner"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show, type JSX } from "solid-js"

const stages = ["Keeping your session safe", "Starting the new background service", "Connecting to OpenCode"] as const

// Real work is never delayed; each stage label lingers at least this long so
// its dissolve sweep and rail movement read as deliberate motion.
const stageFloor = 350

export type Handle = {
  // Idempotent; returns false when no interactive terminal is available and
  // the caller should fall back to plain stderr messaging.
  readonly begin: (from?: string) => boolean
  // Plays the final stage, writes the success receipt, and tears down the
  // renderer. No-op when begin() never ran.
  readonly finish: () => Promise<void>
  // Writes a failure receipt and tears down the renderer. No-op when begin()
  // never ran.
  readonly fail: (message: string) => Promise<void>
}

export const make = (): Handle => {
  let session: Promise<Session | undefined> | undefined
  return {
    begin: (from) => {
      if (!process.stdout.isTTY || !process.stdin.isTTY) return false
      session ??= open(from).catch(() => undefined)
      return true
    },
    finish: async () => {
      const active = await session
      await active?.finish()
    },
    fail: async (message) => {
      const active = await session
      await active?.fail(message)
    },
  }
}

type Session = {
  readonly finish: () => Promise<void>
  readonly fail: (message: string) => Promise<void>
}

async function open(from?: string): Promise<Session> {
  registerOpencodeSpinner()
  const [active, setActive] = createSignal(0)
  const renderer = await createCliRenderer({
    stdin: process.stdin,
    useMouse: false,
    autoFocus: false,
    openConsoleOnError: false,
    exitOnCtrlC: false,
    exitSignals: [],
    screenMode: "split-footer",
    footerHeight: 4,
    targetFps: 60,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
    clearOnShutdown: false,
  })
  const renderTask = render(() => <UpdateFooter from={from} active={active} renderer={renderer} />, renderer)
  void renderTask.catch(() => {})
  renderer.requestRender()
  let shownAt = performance.now()
  const advance = async (stage: number) => {
    const remaining = stageFloor - (performance.now() - shownAt)
    if (remaining > 0) await sleep(remaining)
    setActive(stage)
    shownAt = performance.now()
  }
  // The service replacement runs entirely inside Service.start without
  // intermediate callbacks, so the first transition is time-based. Finer
  // lifecycle hooks (draining, health polling) are a follow-up.
  const auto = advance(1)
  const close = async (content: () => JSX.Element) => {
    await auto
    renderer.writeToScrollback(createScrollbackWriter(content, { startOnNewLine: true, trailingNewline: true }))
    renderer.requestRender()
    await bounded(renderer.idle())
    renderer.externalOutputMode = "passthrough"
    renderer.screenMode = "main-screen"
    if (!renderer.isDestroyed) renderer.destroy()
    await bounded(renderTask)
  }
  return {
    finish: async () => {
      await auto
      await advance(2)
      await sleep(stageFloor)
      await close(() => (
        <box width="100%" flexDirection="row" gap={1}>
          <text fg={colors.success}>✓</text>
          <text fg={colors.muted} attributes={TextAttributes.BOLD}>
            OpenCode
          </text>
          <text fg={colors.muted}>updated to</text>
          <text fg={colors.accent}>{InstallationVersion}</text>
        </box>
      ))
    },
    fail: async (message) => {
      await close(() => (
        <box width="100%" flexDirection="row" gap={1}>
          <text fg={colors.error}>!</text>
          <text fg={colors.text}>{message}</text>
        </box>
      ))
    },
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const bounded = (task: Promise<unknown>) =>
  Promise.race([task, sleep(1_000)]).catch(() => {})

const colors = {
  accent: RGBA.fromHex("#a6b8ff"),
  accentBright: RGBA.fromHex("#eef1ff"),
  accentDim: RGBA.fromHex("#596998"),
  error: RGBA.fromHex("#ff8192"),
  muted: RGBA.fromIndex(8),
  success: RGBA.fromHex("#8bd5a5"),
  text: RGBA.defaultForeground(),
}

// The "O" from the OpenCode logo: exactly footer height. "_" is the
// shadow-filled interior, matching the wordmark's rendering trick.
const monogram = ["█▀▀█", "█__█", "▀▀▀▀"]
const monogramInk = RGBA.fromHex("#808080")
const monogramShadow = RGBA.fromValues(monogramInk.r * 0.25, monogramInk.g * 0.25, monogramInk.b * 0.25)

const sweepBlend = 8
const textBright = RGBA.fromHex("#eeeeee")
const textDim = RGBA.fromHex("#4c4c4c")

// Brightness ramps are precomputed so per-frame cell updates reuse stable
// RGBA instances instead of allocating one per cell per tick.
const rampSteps = 32
const ramp = (from: RGBA, to: RGBA) =>
  Array.from({ length: rampSteps + 1 }, (_, step) => {
    const t = step / rampSteps
    return RGBA.fromValues(from.r + (to.r - from.r) * t, from.g + (to.g - from.g) * t, from.b + (to.b - from.b) * t)
  })
const railRamp = ramp(colors.accentDim, colors.accentBright)
const textRamp = ramp(textDim, textBright)
const shade = (palette: ReadonlyArray<RGBA>, brightness: number) =>
  palette[Math.round(Math.max(0, Math.min(1, brightness)) * rampSteps)]

function Monogram() {
  return (
    <box flexDirection="column">
      <For each={monogram}>
        {(line) => (
          <box flexDirection="row">
            <For each={Array.from(line)}>
              {(char) =>
                char === "_" ? (
                  <text bg={monogramShadow} selectable={false}>
                    {" "}
                  </text>
                ) : (
                  <text fg={monogramInk} selectable={false}>
                    {char}
                  </text>
                )
              }
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function UpdateFooter(props: { from?: string; active: () => number; renderer: CliRenderer }) {
  const term = useTerminalDimensions()
  const [position, setPosition] = createSignal(0)
  const [pulse, setPulse] = createSignal(0)
  const [sweep, setSweep] = createSignal<{ from: string } | undefined>(undefined)
  const [sweepProgress, setSweepProgress] = createSignal(0)
  let sweepValue = 0
  let sweepVelocity = 0
  let previousStage: string = stages[0]
  createEffect(() => {
    const next = stages[props.active()]
    if (next === previousStage) return
    sweepValue = 0
    sweepVelocity = 0
    setSweepProgress(0)
    setSweep({ from: previousStage })
    previousStage = next
  })
  // Stationary dissolve: a front sweeps left to right; ahead of it the old
  // phrase stays bright, behind it the new phrase is bright, and characters
  // dip to dim as the front passes over them.
  const stageCells = createMemo(() => {
    const state = sweep()
    if (!state) return undefined
    const target = stages[props.active()]
    const progress = sweepProgress()
    const length = Math.max(target.length, state.from.length)
    const front = progress * (length + 2 * sweepBlend) - sweepBlend
    return Array.from({ length }, (_, index) => {
      const passed = Math.max(0, Math.min(1, (front - index) / sweepBlend))
      const brightness = Math.abs(passed * 2 - 1)
      return {
        char: (passed >= 0.5 ? target[index] : state.from[index]) ?? " ",
        color: shade(textRamp, brightness),
      }
    })
  })
  const rail = createMemo(() => {
    const width = Math.max(8, Math.min(30, term().width - 39))
    const filled = Math.round(position() * width)
    const glowRadius = 6
    const span = Math.max(1, filled + glowRadius * 2)
    const center = pulse() * span - glowRadius
    return Array.from({ length: width }, (_, index) => {
      if (index >= filled) return { char: "·", color: colors.muted }
      const glow = Math.max(0, 1 - Math.abs(index - center) / glowRadius) ** 2
      return { char: "━", color: shade(railRamp, glow) }
    })
  })

  onMount(() => {
    let value = 0
    let velocity = 0
    let phase = 0
    // Springs integrate inside the renderer's own frame loop, so simulation
    // steps and painted frames share one clock and one delta.
    const frame = async (deltaTime: number) => {
      const elapsed = Math.min(0.032, deltaTime / 1_000)
      const stiffness = 110
      const damping = 2 * Math.sqrt(stiffness)
      const target = (props.active() + 1) / stages.length
      velocity += (stiffness * (target - value) - damping * velocity) * elapsed
      value += velocity * elapsed
      setPosition(Math.max(0, Math.min(1, value)))
      phase = (phase + deltaTime / 900) % 1
      setPulse(phase)
      if (sweep()) {
        const sweepStiffness = 200
        const sweepDamping = 2 * Math.sqrt(sweepStiffness)
        sweepVelocity += (sweepStiffness * (1 - sweepValue) - sweepDamping * sweepVelocity) * elapsed
        sweepValue += sweepVelocity * elapsed
        if (sweepValue >= 0.995) setSweep(undefined)
        else setSweepProgress(sweepValue)
      }
    }
    props.renderer.setFrameCallback(frame)
    onCleanup(() => props.renderer.removeFrameCallback(frame))
  })

  return (
    <box width="100%" height={4} flexDirection="row" gap={1}>
      <Monogram />
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" gap={1}>
          <text fg={colors.muted} attributes={TextAttributes.BOLD}>
            OpenCode
          </text>
          <text fg={colors.muted}>is updating</text>
          <Show when={props.from}>
            <text fg={colors.muted}>from</text>
            <text fg={colors.accentDim}>{props.from}</text>
          </Show>
          <text fg={colors.muted}>to</text>
          <text fg={colors.accent}>{InstallationVersion}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <spinner frames={SPINNER_FRAMES} interval={80} color={colors.accent} />
          <Show
            when={stageCells()}
            fallback={
              <text fg={colors.text} truncate>
                {stages[props.active()]}
              </text>
            }
          >
            {(cells) => (
              <box flexDirection="row">
                <Index each={cells()}>{(cell) => <text fg={cell().color}>{cell().char}</text>}</Index>
              </box>
            )}
          </Show>
        </box>
        <box flexDirection="row" gap={1}>
          <box flexDirection="row">
            <Index each={rail()}>{(segment) => <text fg={segment().color}>{segment().char}</text>}</Index>
          </box>
          <text fg={colors.muted}>
            {props.active() + 1}/{stages.length}
          </text>
        </box>
      </box>
    </box>
  )
}

export * as UpdatePreflight from "./update-preflight"
