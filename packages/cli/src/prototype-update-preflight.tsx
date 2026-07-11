/** @jsxImportSource @opentui/solid */
// PROTOTYPE: throwaway inline update preflight with a custom split footer.
import { createCliRenderer, RGBA, TextAttributes, type CliRenderer } from "@opentui/core"
import { createScrollbackWriter, render, useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { registerOpencodeSpinner } from "@opencode-ai/tui/component/register-spinner"
import { SPINNER_FRAMES } from "@opencode-ai/tui/component/spinner"
import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js"

registerOpencodeSpinner()

const currentVersion = "next-15328"
const nextVersion = "next-15329"
type Stage = { readonly pending: string; readonly work: number; readonly failure?: string }
type Style = { readonly stages: ReadonlyArray<Stage> }
const styles = {
  minimal: {
    stages: [
      { pending: "Restarting the background service", work: 1_200, failure: "The previous service is still available" },
      { pending: "Reconnecting", work: 120 },
    ],
  },
  guided: {
    stages: [
      { pending: "Keeping your session safe", work: 10 },
      { pending: "Starting the new background service", work: 1_200, failure: "The previous service is still available" },
      { pending: "Restoring this workspace", work: 80 },
      { pending: "Connecting to OpenCode", work: 120 },
    ],
  },
  friendly: {
    stages: [
      { pending: "Keeping your place", work: 10 },
      { pending: "Freshening up the background service", work: 1_200, failure: "Your previous service is still running" },
      { pending: "Bringing back your workspace", work: 80 },
    ],
  },
  technical: {
    stages: [
      { pending: "Draining service 22405", work: 200 },
      { pending: `Electing a ${nextVersion} service`, work: 1_200, failure: "Service 22405 remains available" },
      { pending: "Waiting for /api/health", work: 300 },
      { pending: "Waiting for server.connected", work: 100 },
    ],
  },
} as const satisfies Record<string, Style>

const colors = {
  accent: RGBA.fromHex("#a6b8ff"),
  accentBright: RGBA.fromHex("#eef1ff"),
  accentDim: RGBA.fromHex("#596998"),
  error: RGBA.fromHex("#ff8192"),
  muted: RGBA.fromHex("#808080"),
  success: RGBA.fromHex("#8bd5a5"),
  text: RGBA.defaultForeground(),
}

const styleNames = ["minimal", "guided", "friendly", "technical"] as const
const requestedStyle = process.argv.find((arg) => arg.startsWith("--style="))?.slice("--style=".length)
const styleName = styleNames.find((name) => name === requestedStyle)
if (requestedStyle && !styleName)
  throw new Error(`Unknown style: ${requestedStyle}. Choose ${styleNames.join(", ")}.`)
const style: Style = styles[styleName ?? "guided"]
const fail = process.argv.includes("--fail")
const endVariants = ["a", "b", "c", "d"] as const
type EndVariant = (typeof endVariants)[number]
const requestedEnd = process.argv.find((arg) => arg.startsWith("--end="))?.slice("--end=".length)
const endVariant: EndVariant = endVariants.find((name) => name === requestedEnd) ?? "a"
// Real work runs immediately; each stage label lingers at least this long so
// its dissolve sweep and rail movement read as deliberate motion.
const stageFloor = process.argv.includes("--slow") ? 2_500 : 350
const controller = new AbortController()
const [active, setActive] = createSignal(0)
const [done, setDone] = createSignal(false)

// The "O" from the OpenCode logo: exactly footer height. "_" is the
// shadow-filled interior, matching the wordmark's rendering trick.
// Wordmark colors: the O belongs to "Open", rendered in muted text.
const monogram = ["█▀▀█", "█__█", "▀▀▀▀"]
const monogramInk = RGBA.fromHex("#808080")
const monogramShadow = RGBA.fromValues(monogramInk.r * 0.25, monogramInk.g * 0.25, monogramInk.b * 0.25)

function Monogram(props: { ink: () => RGBA }) {
  const shadow = createMemo(() => {
    const ink = props.ink()
    return RGBA.fromValues(ink.r * 0.25, ink.g * 0.25, ink.b * 0.25)
  })
  return (
    <box flexDirection="column">
      <For each={monogram}>
        {(line) => (
          <box flexDirection="row">
            <For each={Array.from(line)}>
              {(char) =>
                char === "_" ? (
                  <text bg={shadow()} selectable={false}>
                    {" "}
                  </text>
                ) : (
                  <text fg={props.ink()} selectable={false}>
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
const successRamp = ramp(RGBA.fromHex("#4a7a5c"), RGBA.fromHex("#b8f0cc"))
const textRamp = ramp(textDim, textBright)
const shade = (palette: ReadonlyArray<RGBA>, brightness: number) =>
  palette[Math.round(Math.max(0, Math.min(1, brightness)) * rampSteps)]

// A sweep line is a sequence of styled cells so mixed-color, mixed-weight
// phrases (like the header) can dissolve without losing their styling.
type Cell = { readonly char: string; readonly color: RGBA; readonly bold?: boolean }
const styled = (text: string, color: RGBA, bold?: boolean): Cell[] =>
  Array.from(text).map((char) => ({ char, color, bold }))
const phrase = (...segments: ReadonlyArray<readonly [string, RGBA, boolean?]>): Cell[] =>
  segments.flatMap((segment, index) => [
    ...(index > 0 ? styled(" ", colors.muted) : []),
    ...styled(segment[0], segment[1], segment[2]),
  ])

// Ramps are cached per target color; segment colors are module constants so
// the cache stays tiny and per-frame cells reuse stable RGBA instances.
const rampCache = new Map<RGBA, ReadonlyArray<RGBA>>()
const rampFor = (color: RGBA) => {
  const cached = rampCache.get(color)
  if (cached) return cached
  const built = ramp(textDim, color)
  rampCache.set(color, built)
  return built
}

// Spring-driven stationary dissolve between two styled lines. tick() must be
// called from the frame loop; cells() is undefined when idle.
function createSweep() {
  const [state, setState] = createSignal<{ from: Cell[]; to: Cell[] } | undefined>(undefined)
  const [progress, setProgress] = createSignal(0)
  let value = 0
  let velocity = 0
  const cells = createMemo(() => {
    const active = state()
    if (!active) return undefined
    const length = Math.max(active.from.length, active.to.length)
    const front = progress() * (length + 2 * sweepBlend) - sweepBlend
    return Array.from({ length }, (_, index) => {
      const passed = Math.max(0, Math.min(1, (front - index) / sweepBlend))
      const brightness = Math.abs(passed * 2 - 1)
      const cell = (passed >= 0.5 ? active.to[index] : active.from[index]) ?? { char: " ", color: textBright }
      return { char: cell.char, color: shade(rampFor(cell.color), brightness), bold: cell.bold }
    })
  })
  return {
    start: (from: Cell[], to: Cell[]) => {
      value = 0
      velocity = 0
      setProgress(0)
      setState({ from, to })
    },
    tick: (elapsed: number) => {
      if (!state()) return
      const stiffness = 200
      const damping = 2 * Math.sqrt(stiffness)
      velocity += (stiffness * (1 - value) - damping * velocity) * elapsed
      value += velocity * elapsed
      if (value >= 0.995) setState(undefined)
      else setProgress(value)
    },
    cells,
  }
}

function UpdateFooter(props: { renderer: CliRenderer }) {
  const term = useTerminalDimensions()
  const [position, setPosition] = createSignal(0)
  const [pulse, setPulse] = createSignal(0)
  const headerSweep = createSweep()
  const stageSweep = createSweep()
  let previousStage = style.stages[0].pending
  createEffect(() => {
    if (done()) return
    const next = style.stages[active()].pending
    if (next === previousStage) return
    stageSweep.start(styled(previousStage, textBright), styled(next, textBright))
    previousStage = next
  })
  // The end state arrives through the same dissolve: both the header and the
  // stage line sweep into their final phrases.
  createEffect(() => {
    if (!done()) return
    headerSweep.start(
      phrase(
        ["OpenCode", colors.muted, true],
        ["is updating from", colors.muted],
        [currentVersion, colors.accentDim],
        ["to", colors.muted],
        [nextVersion, colors.accent],
      ),
      phrase(["OpenCode", colors.muted, true], ["updated to", colors.muted], [nextVersion, colors.accent]),
    )
    stageSweep.start(styled(previousStage, textBright), styled("Ready", textBright))
  })
  const rail = createMemo(() => {
    const width = Math.max(8, Math.min(30, term().width - 39))
    if (done()) {
      const palette = endVariant === "b" || endVariant === "d" ? successRamp : railRamp
      return Array.from({ length: width }, () => ({ char: "━", color: shade(palette, 0.55) }))
    }
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
      const target = (active() + 1) / style.stages.length
      const sprung = done() ? 1 : target
      velocity += (stiffness * (sprung - value) - damping * velocity) * elapsed
      value += velocity * elapsed
      setPosition(Math.max(0, Math.min(1, value)))
      phase = (phase + deltaTime / 900) % 1
      setPulse(phase)
      headerSweep.tick(elapsed)
      stageSweep.tick(elapsed)
    }
    props.renderer.setFrameCallback(frame)
    onCleanup(() => props.renderer.removeFrameCallback(frame))
  })

  useKeyboard((event) => {
    if (event.name !== "escape" && !(event.ctrl && event.name === "c")) return
    event.preventDefault()
    controller.abort()
  })

  return (
    <box width="100%" height={4} flexDirection="row" gap={1}>
      <Monogram ink={() => (done() && (endVariant === "c" || endVariant === "d") ? colors.accent : monogramInk)} />
      <box flexDirection="column" flexGrow={1}>
        <Show
          when={headerSweep.cells()}
          fallback={
            <Show
              when={done()}
              fallback={
                <box flexDirection="row" gap={1}>
                  <text fg={colors.muted} attributes={TextAttributes.BOLD}>
                    OpenCode
                  </text>
                  <text fg={colors.muted}>is updating from</text>
                  <text fg={colors.accentDim}>{currentVersion}</text>
                  <text fg={colors.muted}>to</text>
                  <text fg={colors.accent}>{nextVersion}</text>
                </box>
              }
            >
              <box flexDirection="row" gap={1}>
                <text fg={colors.muted} attributes={TextAttributes.BOLD}>
                  OpenCode
                </text>
                <text fg={colors.muted}>updated to</text>
                <text fg={colors.accent}>{nextVersion}</text>
              </box>
            </Show>
          }
        >
          {(cells) => (
            <box flexDirection="row">
              <Index each={cells()}>
                {(cell) => (
                  <text fg={cell().color} attributes={cell().bold ? TextAttributes.BOLD : undefined}>
                    {cell().char}
                  </text>
                )}
              </Index>
            </box>
          )}
        </Show>
        <box flexDirection="row" gap={1}>
          <Show when={!done()} fallback={<text fg={colors.success}>✓</text>}>
            <spinner frames={SPINNER_FRAMES} interval={80} color={colors.accent} />
          </Show>
          <Show
            when={stageSweep.cells()}
            fallback={
              <text fg={colors.text} truncate>
                {done() ? "Ready" : style.stages[active()].pending}
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
            {active() + 1}/{style.stages.length}
          </text>
        </box>
      </box>
    </box>
  )
}

function receipt(marker: string, text: string, color: RGBA) {
  return createScrollbackWriter(
    () => (
      <box width="100%" flexDirection="row" gap={1}>
        <text fg={color}>{marker}</text>
        <text fg={colors.text}>{text}</text>
      </box>
    ),
    { startOnNewLine: true, trailingNewline: true },
  )
}

const successReceipt = () =>
  createScrollbackWriter(
    () => (
      <box width="100%" flexDirection="row" gap={1}>
        <text fg={colors.success}>✓</text>
        <text fg={colors.muted} attributes={TextAttributes.BOLD}>
          OpenCode
        </text>
        <text fg={colors.muted}>updated to</text>
        <text fg={colors.accent}>{nextVersion}</text>
      </box>
    ),
    { startOnNewLine: true, trailingNewline: true },
  )

const wait = (ms: number) => {
  if (controller.signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      controller.signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    controller.signal.addEventListener("abort", finish, { once: true })
  })
}

function bounded(task: Promise<unknown>) {
  return Promise.race([task, new Promise<void>((resolve) => setTimeout(resolve, 1_000))])
}

async function flush(renderer: CliRenderer) {
  renderer.requestRender()
  await bounded(renderer.idle()).catch(() => {})
}

async function shutdown(renderer: CliRenderer, renderTask: Promise<void>) {
  await bounded(renderer.idle()).catch(() => {})
  try {
    renderer.externalOutputMode = "passthrough"
  } finally {
    try {
      renderer.screenMode = "main-screen"
    } finally {
      if (!renderer.isDestroyed) renderer.destroy()
    }
  }
  await bounded(renderTask).catch(() => {})
}

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("This prototype requires an interactive terminal")
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]
const cancel = () => controller.abort()
signals.forEach((signal) => process.on(signal, cancel))
let renderer: CliRenderer | undefined
let renderTask: Promise<void> | undefined
let renderError: unknown

try {
  process.stdout.write("\n")
  renderer = await createCliRenderer({
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
  const activeRenderer = renderer
  renderTask = render(() => <UpdateFooter renderer={activeRenderer} />, activeRenderer)
  void renderTask.catch((error) => {
    renderError = error
    controller.abort()
  })
  await flush(activeRenderer)
  let outcome = 0
  for (const [index, stage] of style.stages.entries()) {
    if (controller.signal.aborted) break
    setActive(index)
    activeRenderer.requestRender()
    await wait(Math.max(stage.work, stageFloor))
    if (fail && stage.failure) {
      activeRenderer.writeToScrollback(receipt("!", `Update paused · ${stage.failure}`, colors.error))
      await flush(activeRenderer)
      outcome = 1
      break
    }
  }
  if (!controller.signal.aborted && outcome === 0) {
    // Live-only end state: the footer itself celebrates, holds briefly, and
    // hands the screen to the TUI. Nothing is written to scrollback.
    setDone(true)
    activeRenderer.requestRender()
    await wait(1_500)
  }
  process.exitCode = controller.signal.aborted ? 130 : outcome
} finally {
  signals.forEach((signal) => process.off(signal, cancel))
  if (renderer && renderTask) await shutdown(renderer, renderTask)
}

if (renderError) throw renderError
