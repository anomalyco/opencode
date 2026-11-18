// The shot-list format shared with the render pipelines (product-videos/<pipeline>/edits/*.json, see EDITOR.md),
// the engine's interface (product-videos/editor/engine.mjs, loaded at runtime) and the pure edit operations.

export type Cam = { cx: number; cy: number; s: number; rx: number; ry: number; rz: number }
export type DriftCam = { cx: number; cy: number; w: number; rx?: number; ry?: number; rz?: number; persp?: number }
export type Pin = { t: number; cx: number; cy: number; w?: number }
export type Glide = { t: number; dx?: number; dy?: number; zoom?: number; w?: number }
export type Transition = { type: "cut" } | { type: "dissolve"; frames: number } | { type: "glide" }
export type Dof = { a: number; b: number; blur: number }

export type Shot = {
  id: string
  note?: string
  source?: string
  time: [number, number][]
  keys?: [number, Cam][]
  a?: DriftCam
  pin?: Pin
  glides?: Glide[]
  dof?: Dof
  persp?: number
  transition?: Transition
  blur?: boolean
}

export type Source = { dir: string; w: number; h: number; frames: number; fps?: number; pad?: number; blank?: number[] }

export type Edit = {
  version: number
  pipeline: string
  product: string
  aspect: "portrait" | "landscape"
  name?: string
  title: string
  engine: "keys" | "drift"
  size: [number, number]
  unit: "seconds" | "frames"
  source: string
  sources: Record<string, Source>
  styles: Record<string, { set: string; crf: number; budget?: number }>
  render: { compose: string }
  soft?: number
  dissolve?: number
  shots: Shot[]
}

export type EngineCam = Cam & { persp: number }
export type Box = { x: number; y: number; w: number; h: number }
export type Check = { shot: number; level: "warn" | "info"; text: string }
export type Frame = { method: "renderMulti" | "render"; arg: unknown; samples: number; shot: number }
export type Plan = {
  total: number
  count: number
  list: { shot: Shot; start: number; duration: number }[]
  frame(n: number): Frame
  cam(i: number, local: number): EngineCam
  srcTime(i: number, local: number): number
  indexAt(t: number): number
}
export type Engine = {
  FPS: number
  plan(edit: Edit, style: string, options: { url: (key: string, index: number) => string; blur?: boolean }): Plan
  checks(edit: Edit, style: string): Check[]
  camBox(edit: Edit, cam: { cx: number; cy: number; s?: number; w?: number }): Box
  boxCam<T extends { cx: number; cy: number }>(edit: Edit, cam: T, box: Box): T
  frameIndex(edit: Edit, key: string, srcT: number): number
  transitionOf(edit: Edit, style: string, shot: Shot): Transition
  baseScale(edit: Edit, w: number): number
}

const PROPS = ["cx", "cy", "s", "rx", "ry", "rz"] as const
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
export const camOf = (cam: EngineCam): Cam =>
  Object.fromEntries(PROPS.map((prop) => [prop, round(cam[prop], prop === "s" ? 4 : 2)])) as Cam

/** JSON with short arrays and flat objects on one line, so a shot list stays readable in a diff. */
export function formatEdit(edit: Edit) {
  const oneLine = (inner: string) => inner.replace(/\s*\n\s*/g, " ")
  return (
    JSON.stringify(edit, null, 2)
      .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${oneLine(inner)}]`)
      .replace(/\{\s+([^[\]{}]*?)\s+\}/g, (_, inner: string) => `{ ${oneLine(inner)} }`)
      .replace(/\[\s+([^[\]{}]*\{[^{}\n]*\}[^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${oneLine(inner)}]`)
      .replace(
        /\[\s+((?:\[[^[\]{}]*\],?\s*)+)\]/g,
        (_, inner: string) => `[${inner.replace(/,\s*\n\s*/g, ", ").trim()}]`,
      ) + "\n"
  )
}

/** Source units per second of source time (frames for the terminal and SDK recordings, else seconds). */
export const unitRate = (edit: Edit, shot: Shot) =>
  edit.unit === "frames" ? (edit.sources[shot.source ?? edit.source].fps ?? 30) : 1

/** Average playback speed of a shot (source seconds per output second). */
export function speedOf(edit: Edit, shot: Shot) {
  const first = shot.time[0]
  const last = shot.time.at(-1) ?? first
  return (last[1] - first[1]) / unitRate(edit, shot) / Math.max(1e-6, last[0] - first[0])
}

export const durationOf = (shot: Shot) => shot.time.at(-1)?.[0] ?? 0

export function moveShot(shots: Shot[], from: number, to: number) {
  const list = shots.slice()
  const [item] = list.splice(from, 1)
  list.splice(to > from ? to - 1 : to, 0, item)
  return list
}

export function uniqueId(shots: Shot[], base: string) {
  const stem = base.replace(/\d+$/, "")
  const taken = new Set(shots.map((shot) => shot.id))
  const n = Array.from({ length: shots.length + 2 }, (_, i) => i + 2).find((i) => !taken.has(`${stem}${i}`))
  return `${stem}${n}`
}

/** Scales a shot's output times (time map, keys) so it plays at `speed` on average. */
export function setSpeed(edit: Edit, shot: Shot, speed: number): Shot {
  const factor = speedOf(edit, shot) / Math.max(0.05, speed)
  return {
    ...shot,
    time: shot.time.map(([t, s]) => [round(t * factor), s]),
    keys: shot.keys?.map(([t, cam]) => [round(t * factor), cam]),
  }
}

/**
 * Moves the shot's first (in) or last (out) source point, keeping that segment's speed: the shot gets shorter or
 * longer and the later points and keys shift with it. `cam` evaluates the shot's camera at a local time.
 */
export function trim(shot: Shot, side: "in" | "out", src: number, cam: (local: number) => EngineCam): Shot {
  const time = shot.time
  if (side === "in") {
    const [t0, s0] = time[0]
    const [t1, s1] = time[1]
    const rate = (s1 - s0) / (t1 - t0)
    const dt = (src - s0) / rate
    const rest = time
      .slice(1)
      .map(([t, s]): [number, number] => [round(t - t0 - dt), s])
      .filter(([t]) => t > 0.05)
    const nextTime: [number, number][] = [[0, src], ...rest]
    if (nextTime.length < 2) return shot
    const keys = shot.keys
    if (!keys) return { ...shot, time: nextTime }
    const shifted = keys.map(([t, c]): [number, Cam] => [round(t - dt), c]).filter(([t]) => t > 0.05)
    return { ...shot, time: nextTime, keys: [[0, camOf(cam(dt))], ...shifted] }
  }
  const [ta, sa] = time.at(-2) ?? time[0]
  const [tb, sb] = time.at(-1) ?? time[0]
  const rate = (sb - sa) / (tb - ta)
  const end = round(tb + (src - sb) / rate)
  const kept = time.slice(0, -1).filter(([t]) => t < end - 0.05)
  if (kept.length === 0) return shot
  const nextTime: [number, number][] = [...kept, [end, src]]
  const keys = shot.keys
  if (!keys) return { ...shot, time: nextTime }
  if (!keys.some(([t]) => t > end)) return { ...shot, time: nextTime }
  return { ...shot, time: nextTime, keys: [...keys.filter(([t]) => t < end - 0.05), [end, camOf(cam(end))]] }
}

/** Splits a shot at a local time into two shots that play the same frames with the same camera. */
export function split(
  edit: Edit,
  shots: Shot[],
  index: number,
  local: number,
  cam: (local: number) => EngineCam,
  src: (local: number) => number,
) {
  const shot = shots[index]
  const at = round(local)
  if (at <= 0.1 || at >= durationOf(shot) - 0.1) return shots
  const s = round(src(local), edit.unit === "frames" ? 2 : 4)
  const before: Shot = { ...shot, time: [...shot.time.filter(([t]) => t < at), [at, s]], transition: { type: "cut" } }
  const after: Shot = {
    ...shot,
    id: uniqueId(shots, shot.id),
    time: [[0, s], ...shot.time.filter(([t]) => t > at).map(([t, v]): [number, number] => [round(t - at), v])],
  }
  if (shot.keys) {
    const c = camOf(cam(local))
    before.keys = [...shot.keys.filter(([t]) => t < at), [at, c]]
    after.keys = [[0, c], ...shot.keys.filter(([t]) => t > at).map(([t, k]): [number, Cam] => [round(t - at), k])]
  }
  if (shot.a) {
    const c = cam(local)
    after.a = {
      ...shot.a,
      cx: round(c.cx, 1),
      cy: round(c.cy, 1),
      w: round(driftWidth(edit, c.s), 1),
      rx: round(c.rx, 2),
      ry: round(c.ry, 2),
    }
    const pinIn = (pin: Pin | undefined, from: number, to: number) =>
      pin && pin.t >= from && pin.t < to ? pin : undefined
    before.pin = pinIn(shot.pin, -Infinity, s)
    after.pin = pinIn(shot.pin, s, Infinity)
    after.glides = shot.glides?.filter((glide) => glide.t > s)
  }
  return [...shots.slice(0, index), before, after, ...shots.slice(index + 1)]
}

/** The source width a drift camera shows across the output at scale s (inverse of the engine's baseScale). */
export const driftWidth = (edit: Edit, s: number) =>
  edit.aspect === "landscape" ? ((edit.size[1] / 1350) * 1080 * 1.15) / s : edit.size[0] / s
