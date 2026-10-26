import { Schema } from "effect"
import { motionTuning, type MotionKnob } from "@opencode/ui/motion-tuning"
import type { KnobValue, TourStop } from "./manifest"

/** What a stop's setup drives: the app's own router, tabs, settings, commands, palette and dialogs. */
export type TourApp = {
  navigate: (path: string) => void
  /** The first healthy server's route segment and session path. */
  serverSegment: () => string | undefined
  sessionPath: (sessionID: string) => string | undefined
  /** Opens a session on the first healthy server as a tab, without going to it. */
  openTab: (sessionID: string) => void
  /** Opens a Settings page; false when there's no such page. */
  settings: (tab: string) => boolean
  /** The appearance settings, once they've loaded. */
  appearance: () => Required<TourAppearance> | undefined
  setAppearance: (values: TourAppearance) => void
  /** The debug extension's stored state, once it has loaded, whether or not its lazy bar has mounted yet. */
  debug: () => TourDebug | undefined
  setDebug: (state: TourDebug) => void
  palette: () => void
  dialogOpen: () => boolean
  closeDialog: () => void
}

export type TourAppearance = NonNullable<TourStop["appearance"]>

/** Whether the debug bar shows, and its Knobs panel with it. */
export type TourDebug = { visible: boolean; motion: boolean }

/**
 * Runs a stop's setup in order: its tabs, its appearance, one place to go, the debug bar, its knobs, then the palette.
 * Spotlights and the Knobs card follow on their own.
 */
export async function arrive(stop: TourStop, app: TourApp, scope: StopScope, signal: AbortSignal) {
  if (app.dialogOpen()) app.closeDialog()

  // Right after a load, the servers haven't answered their first health check yet.
  if (stop.session !== undefined || stop.tabs?.length || stop.route?.includes(":server"))
    await until(app.serverSegment, signal, "a healthy server")

  stop.tabs?.forEach(app.openTab)

  if (stop.appearance) await scope.appearance(stop.appearance, signal)

  go(stop, app)

  if (stop.debug) await scope.debug(stop.debug, signal)

  if (stop.knobs) await scope.knobs(stop.knobs, signal)

  if (stop.palette === undefined) return

  const text = stop.palette

  await until(() => (app.dialogOpen() ? undefined : true), signal)

  // A page still loading may not have registered the palette's command yet, so opening retries until a dialog shows.
  let opened = 0
  const field = () => document.querySelector<HTMLInputElement>('[role="dialog"] input')

  await until(() => {
    if (field()) return true

    if (app.dialogOpen() || performance.now() - opened < 750) return
    opened = performance.now()
    app.palette()
  }, signal)

  // Typed a letter at a time, so a recording shows the list filtering as it would by hand. Each letter finds the field
  // again, in case the palette re-rendered it.
  for (const end of text.split("").keys()) {
    await delay(45, signal)

    const input = await until(field, signal)
    input.value = text.slice(0, end + 1)
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text[end] }))
  }
}

function go(stop: TourStop, app: TourApp) {
  if (stop.route !== undefined) return app.navigate(stop.route.replaceAll(":server", app.serverSegment() ?? ""))

  if (stop.session !== undefined) return app.navigate(app.sessionPath(stop.session) ?? "/")

  if (stop.story !== undefined) return app.navigate(`/components?story=${encodeURIComponent(stop.story)}`)

  if (stop.settings !== undefined && !app.settings(stop.settings)) throw new Error(`No Settings page ${stop.settings}`)
}

/**
 * What a stop changed, so leaving it puts it back: knobs, appearance and the debug bar. Each is read from its state,
 * never the page, so a surface still loading when the stop ends still goes back. Knobs register when their surface's
 * module loads, so a value for one that hasn't registered yet waits for it.
 */
export function stopScope(app: TourApp) {
  const original = new Map<string, { knob: MotionKnob; value: MotionKnob["value"] }>()
  const undo: (() => void)[] = []

  const remember = (knob: MotionKnob) => {
    if (!original.has(knob.id)) original.set(knob.id, { knob, value: knob.value })
  }

  return {
    async knobs(values: { readonly [id: string]: KnobValue }, signal: AbortSignal) {
      const knobs = await registered(values, signal)

      knobs.forEach((knob) => {
        remember(knob)
        setKnob(knob, values[knob.id])
      })
    },
    /** Knobs the stop's card may change, so they go back too. */
    remember: (knobs: readonly MotionKnob[]) => knobs.forEach(remember),
    /** Whether the knobs hold these values. */
    async holds(values: { readonly [id: string]: KnobValue }, signal: AbortSignal) {
      const knobs = await registered(values, signal)

      return knobs.every((knob) => JSON.stringify(knob.value) === JSON.stringify(values[knob.id]))
    },
    async appearance(values: TourAppearance, signal: AbortSignal) {
      const before = await until(app.appearance, signal, "the settings")
      app.setAppearance(values)
      undo.push(() => app.setAppearance(before))
    },
    async debug(level: NonNullable<TourStop["debug"]>, signal: AbortSignal) {
      const before = await until(app.debug, signal, "the debug bar")
      app.setDebug({ visible: true, motion: level === "knobs" })
      undo.push(() => app.setDebug(before))
    },
    restore() {
      undo
        .splice(0)
        .toReversed()
        .forEach((step) => step())
      original.forEach((entry) => motionTuning.set(entry.knob, entry.value))
      original.clear()
    },
  }
}

export type StopScope = ReturnType<typeof stopScope>

function registered(values: { readonly [id: string]: KnobValue }, signal: AbortSignal) {
  return Promise.all(
    Object.keys(values).map((id) =>
      until(() => motionTuning.list().find((knob) => knob.id === id), signal, `the knob ${id}`),
    ),
  )
}

function setKnob(knob: MotionKnob, value: KnobValue | undefined) {
  if (knob.kind === "choice" && isText(value) && knob.options.includes(value)) return motionTuning.set(knob, value)

  if ((knob.kind === "toggle" || knob.kind === "mode") && isBoolean(value)) return motionTuning.set(knob, value)

  if (knob.kind === "number" && isNumber(value)) return motionTuning.set(knob, value)

  if (knob.kind === "spring" && isSpring(value)) return motionTuning.set(knob, value)

  throw new Error(`${knob.id} can't be ${JSON.stringify(value)}`)
}

/**
 * Resolves with the first value `read` gives other than null, undefined or false within 15 seconds (a session can be
 * slow to load), checking each frame. `waiting` names what it waits for in the timeout's error.
 */
export function until<T>(
  read: () => T | null | undefined | false,
  signal: AbortSignal,
  waiting = "the app",
  timeout = 15_000,
) {
  return new Promise<T>((resolve, reject) => {
    const started = performance.now()

    const check = () => {
      if (signal.aborted) return reject(signal.reason)

      const value = read()

      if (value !== null && value !== undefined && value !== false) return resolve(value)

      if (performance.now() - started > timeout) return reject(new Error(`Timed out waiting for ${waiting}`))
      requestAnimationFrame(check)
    }

    check()
  })
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)

    const timer = setTimeout(resolve, ms)

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

const isText = Schema.is(Schema.String)

const isBoolean = Schema.is(Schema.Boolean)

const isNumber = Schema.is(Schema.Finite)

const isSpring = Schema.is(Schema.Struct({ duration: Schema.Finite, bounce: Schema.Finite }))
