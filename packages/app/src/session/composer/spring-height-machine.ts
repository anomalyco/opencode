import { Spring, type DurationOptions } from "@opencode/ui/motion"

/** Faces present on mount rest immediately: a change this soon after mount swaps without a flight. */
export const MORPH_MOUNT_GRACE_MS = 250

export const FADE_CURVE: DurationOptions = Object.freeze({ duration: 0.15, bounce: 0 })

// The springs inside a flight are mutable physics owned by the machine: a `frame` steps them and the pose fields in
// place and returns the same state, so the frame loop allocates nothing and writes no signal until the flight ends.

/** One face of `ComposerMorph`. The pose fields (`box`, `offset`, `progress`) are written by every flight frame. */
export type MorphFace<T extends { readonly key: string }> = {
  readonly id: number
  readonly value: T
  readonly presence: Spring
  /** Border-box height from the face's ResizeObserver. `undefined` until measured, so 0 is a real height. */
  height: number | undefined
  box: number
  offset: number
  progress: number
}

/**
 * `resting` shows one face. `flying` grows the region from the leaving faces to `entering` on one height spring while
 * each leaving face closes in its own box; `faces` stacks docks above the composer and holds `entering` once.
 */
export type MorphState<T extends { readonly key: string }> =
  | { readonly status: "resting"; readonly seq: number; readonly attempt: number; readonly face: MorphFace<T> }
  | {
      readonly status: "flying"
      readonly seq: number
      readonly attempt: number
      readonly height: Spring
      readonly entering: MorphFace<T>
      readonly faces: readonly MorphFace<T>[]
      /** The region's height in CSS px, written by every frame. */
      shown: number
    }
  | { readonly status: "disposed" }

export type MorphCurves = { readonly morph: DurationOptions; readonly fadeIn: DurationOptions }

export type MorphEvent<T extends { readonly key: string }> =
  | {
      readonly type: "face.changed"
      readonly face: T
      readonly instant: boolean
      readonly reduced: boolean
      readonly dpr: number
      /** The region's rendered height, read only when a flight starts from rest. */
      readonly from: number
      readonly curves: MorphCurves
    }
  | { readonly type: "face.measured"; readonly id: number; readonly height: number }
  | { type: "frame"; attempt: number; dt: number; reduced: boolean; dpr: number }
  | { readonly type: "settle" }
  | { readonly type: "disposed" }

export const SETTLE_MORPH_EVENT = Object.freeze({ type: "settle" as const })

export const DISPOSED_MORPH_EVENT = Object.freeze({ type: "disposed" as const })

export const DISPOSED_MORPH_STATE = Object.freeze({ status: "disposed" as const })

export function createMorphState<T extends { readonly key: string }>(face: T): MorphState<T> {
  return { status: "resting", seq: 1, attempt: 0, face: createFace(1, face, 1) }
}

export function transitionMorph<T extends { readonly key: string }>(
  state: MorphState<T>,
  event: MorphEvent<T>,
): MorphState<T> {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_MORPH_STATE

  if (event.type === "face.measured") {
    const face =
      state.status === "resting"
        ? state.face.id === event.id
          ? state.face
          : undefined
        : findFace(state.faces, event.id)

    if (face) face.height = event.height

    return state
  }

  if (event.type === "settle") return state.status === "flying" ? rest(state) : state

  if (event.type === "frame")
    return state.status === "flying" && event.attempt === state.attempt ? step(state, event) : state

  return change(state, event)
}

function change<T extends { readonly key: string }>(
  state: Exclude<MorphState<T>, { status: "disposed" }>,
  event: Extract<MorphEvent<T>, { type: "face.changed" }>,
): MorphState<T> {
  const active = state.status === "resting" ? state.face : state.entering

  // The same face with new content keeps its slot and any flight in progress.
  if (event.face.key === active.value.key) {
    if (event.face === active.value) return state
    const face = { ...active, value: event.face }

    if (state.status === "resting") return { ...state, face }

    return { ...state, entering: face, faces: state.faces.map((item) => (item === active ? face : item)) }
  }

  if (event.instant)
    return {
      status: "resting",
      seq: state.seq + 1,
      attempt: state.attempt,
      face: createFace(state.seq + 1, event.face, 1),
    }

  const faces = state.status === "resting" ? [state.face] : state.faces
  // Going back to the composer mid-flight brings its closing face back rather than mounting a second one.
  const back = event.face.key === "composer" ? faces.find((item) => item.value.key === "composer") : undefined
  const seq = back ? state.seq : state.seq + 1
  const entering = { ...(back ?? createFace(seq, event.face, 0)), value: event.face }
  const curve = event.reduced ? FADE_CURVE : event.curves.morph
  // A face that has all but closed is dropped.
  const kept = faces.filter((item) => item !== back && item.presence.value >= 0.01)

  // A closing face's box closes on the region's spring, so the boxes always add up to the region.
  kept.forEach((item) => tune(item.presence, curve).set(0))
  tune(entering.presence, event.reduced ? FADE_CURVE : event.curves.fadeIn).set(1)
  const height = state.status === "flying" ? state.height : Spring.fromDuration(event.from, event.curves.morph)
  tune(height, event.curves.morph)

  const next: MorphState<T> = {
    status: "flying",
    seq,
    attempt: state.status === "flying" ? state.attempt : state.attempt + 1,
    height,
    entering,
    // Docks always stack above the composer, whichever is coming or going.
    faces: (back
      ? faces.flatMap((item) => (item === back ? [entering] : kept.includes(item) ? [item] : []))
      : [...kept, entering]
    ).toSorted((a, b) => Number(a.value.key === "composer") - Number(b.value.key === "composer")),
    shown: 0,
  }

  layout(next, event.reduced, event.dpr)

  return next
}

function step<T extends { readonly key: string }>(
  state: Extract<MorphState<T>, { status: "flying" }>,
  event: Extract<MorphEvent<T>, { type: "frame" }>,
): MorphState<T> {
  const height = state.height
  const measured = state.entering.height

  // A face that just mounted has no height until its ResizeObserver reports one.
  if (measured !== undefined && height.target !== measured) height.set(measured)

  if (event.reduced) height.snap(height.target)
  height.step(event.dt)

  if (Math.abs(height.value - height.target) < 0.5 && Math.abs(height.velocity) < 5) height.snap(height.target)
  // Under reduced motion the closing faces fade out in full before the new face fades in.
  const waiting = event.reduced && closing(state)
  let resting = height.resting

  for (const face of state.faces) {
    if (!waiting || face !== state.entering) {
      const presence = face.presence
      presence.step(event.dt)

      if (Math.abs(presence.value - presence.target) < 0.01 && Math.abs(presence.velocity) < 0.05)
        presence.snap(presence.target)
    }

    resting &&= face.presence.resting
  }

  if (resting) return rest(state)
  layout(state, event.reduced, event.dpr)

  return state
}

// Each face gets a box: a closing face keeps its presence's share of its height, and the face coming in takes what is
// left of the region. The faces stack in order, so each one's offset is the sum of the boxes above it.
function layout<T extends { readonly key: string }>(
  state: Extract<MorphState<T>, { status: "flying" }>,
  reduced: boolean,
  dpr: number,
) {
  const entering = state.entering
  const waiting = reduced && closing(state)
  let used = 0
  let held = 0

  for (const face of state.faces) {
    if (face === entering) continue
    const height = face.height ?? 0
    face.box = reduced ? (waiting ? height : 0) : snap(height * clamp(face.presence.value), dpr)
    face.progress = clamp(reduced ? face.presence.value : face.box / Math.max(1, height))
    used += face.box

    if (face.presence.value > 0.01) held += height
  }

  state.shown = !reduced ? snap(state.height.value, dpr) : waiting ? held : state.height.target
  entering.box = waiting ? 0 : Math.max(0, Math.min(entering.height ?? 0, state.shown - used))
  entering.progress = clamp(entering.presence.value)
  let offset = 0

  for (const face of state.faces) {
    face.offset = offset
    offset += face.box
  }
}

function closing<T extends { readonly key: string }>(state: Extract<MorphState<T>, { status: "flying" }>) {
  for (const face of state.faces) if (face !== state.entering && face.presence.value > 0.01) return true

  return false
}

function rest<T extends { readonly key: string }>(state: Extract<MorphState<T>, { status: "flying" }>): MorphState<T> {
  return { status: "resting", seq: state.seq, attempt: state.attempt, face: state.entering }
}

function createFace<T extends { readonly key: string }>(id: number, value: T, presence: number): MorphFace<T> {
  return { id, value, presence: new Spring(presence), height: undefined, box: 0, offset: 0, progress: presence }
}

function findFace<T extends { readonly key: string }>(faces: readonly MorphFace<T>[], id: number) {
  for (const face of faces) if (face.id === id) return face

  return undefined
}

/** The face the morph is showing or flying to. */
export function morphActive<T extends { readonly key: string }>(state: MorphState<T>) {
  if (state.status === "disposed") return undefined

  return state.status === "resting" ? state.face : state.entering
}

export function morphFaces<T extends { readonly key: string }>(state: MorphState<T>): readonly MorphFace<T>[] {
  if (state.status === "disposed") return []

  return state.status === "resting" ? [state.face] : state.faces
}

export function morphFace<T extends { readonly key: string }>(state: MorphState<T>, id: number) {
  return findFace(morphFaces(state), id)
}

export function isMorphFaceLeaving<T extends { readonly key: string }>(state: MorphState<T>, id: number) {
  return state.status === "flying" && state.entering.id !== id && !!findFace(state.faces, id)
}

export function hasInstantMorphFace<T extends { readonly key: string }>(
  state: MorphState<T>,
  instant: ((face: T) => boolean) | undefined,
) {
  return !!instant && morphFaces(state).some((face) => instant(face.value))
}

/**
 * `Grow` mounts its children while `opening`, `present` or `closing`. A flight holds the springs, the layout read on
 * its first frame (`measured`) and the pose every frame writes. `attempt` numbers the flight, so a frame, measure or
 * resize from an earlier one is ignored; turning back mid-flight keeps it.
 */
export type GrowFlight = {
  readonly attempt: number
  readonly spring: Spring
  readonly presence: Spring
  readonly fade: boolean
  readonly card: boolean
  /** A close from rest starts from the rendered height, which the first frame reads. */
  readonly fromRendered: boolean
  measured: boolean
  marginBelow: number
  marginAbove: number
  margin: number
  full: number
  height: number
  marginBottom: number
  marginTop: number
  progress: number
  hidden: number
}

export type GrowState =
  | { readonly status: "absent"; readonly attempt: number }
  | { readonly status: "present"; readonly attempt: number }
  | ({ readonly status: "opening" } & GrowFlight)
  | ({ readonly status: "closing" } & GrowFlight)
  | { readonly status: "disposed" }

export type GrowCurves = {
  readonly open: DurationOptions
  readonly close: DurationOptions
  readonly fadeIn: DurationOptions
}

export type GrowEvent =
  | {
      readonly type: "sync"
      readonly open: boolean
      /** Only on mount, when the children are there already and should grow in. */
      readonly appear: boolean
      readonly instant: boolean
      readonly reduced: boolean
      readonly fade: boolean
      readonly card: boolean
      readonly curves: GrowCurves
    }
  | {
      readonly type: "measured"
      readonly attempt: number
      readonly marginBelow: number
      readonly marginAbove: number
      readonly margin: number
      readonly full: number
      readonly rendered: number
    }
  | { readonly type: "resized"; readonly attempt: number; readonly size: number }
  | { type: "frame"; attempt: number; dt: number; dpr: number }
  | { readonly type: "detached"; readonly attempt: number }
  | { readonly type: "reduced" }
  | { readonly type: "disposed" }

export const REDUCED_GROW_EVENT: GrowEvent = Object.freeze({ type: "reduced" })

export const DISPOSED_GROW_EVENT: GrowEvent = Object.freeze({ type: "disposed" })

export const DISPOSED_GROW_STATE: GrowState = Object.freeze({ status: "disposed" })

export function createGrowState(open: boolean): GrowState {
  return { status: open ? "present" : "absent", attempt: 0 }
}

export function transitionGrow(state: GrowState, event: GrowEvent): GrowState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_GROW_STATE

  if (event.type === "sync") return sync(state, event)

  if (!isGrowMoving(state)) return state

  // Reduce Motion turning on mid-flight lands it where it was going.
  if (event.type === "reduced") return land(state)

  if (event.attempt !== state.attempt) return state

  // A detached element (a cached tab in the background) never gets a frame that could finish it.
  if (event.type === "detached") return land(state)

  if (event.type === "measured") {
    if (state.measured) return state
    state.measured = true
    state.marginBelow = event.marginBelow
    state.marginAbove = event.marginAbove
    state.margin = event.margin
    state.full = event.full

    if (state.fromRendered) state.spring.snap(event.rendered)

    return state
  }

  if (event.type === "resized") {
    state.full = event.size + state.margin

    return state
  }

  return grow(state, event)
}

function sync(
  state: Exclude<GrowState, { status: "disposed" }>,
  event: Extract<GrowEvent, { type: "sync" }>,
): GrowState {
  const open = event.open

  if (isGrowMoving(state)) {
    // Turning instant mid-flight finishes the flight where it is now going.
    if (event.instant) return { status: open ? "present" : "absent", attempt: state.attempt }

    if (open === (state.status === "opening")) return state
    tune(state.spring, event.reduced ? FADE_CURVE : open ? event.curves.open : event.curves.close)
    tune(state.presence, event.reduced ? FADE_CURVE : event.curves.fadeIn)

    return { ...state, status: open ? "opening" : "closing" }
  }

  if (open === (state.status === "present") && !(open && event.appear && !event.instant)) return state

  if (event.instant) return { status: open ? "present" : "absent", attempt: state.attempt }

  const flight: GrowFlight = {
    attempt: state.attempt + 1,
    // A closing box starts from its height, which the first frame measures.
    spring: Spring.fromDuration(0, event.reduced ? FADE_CURVE : open ? event.curves.open : event.curves.close),
    // Opening fades in on its own spring; closing fades with the height, inside the closing box.
    presence: Spring.fromDuration(open ? 0 : 1, event.reduced ? FADE_CURVE : event.curves.fadeIn),
    fade: event.fade,
    card: event.card,
    fromRendered: !open,
    measured: false,
    marginBelow: 0,
    marginAbove: 0,
    margin: 0,
    full: 0,
    height: 0,
    marginBottom: 0,
    marginTop: 0,
    progress: open ? 0 : 1,
    hidden: 0,
  }

  return open ? { ...flight, status: "opening" } : { ...flight, status: "closing" }
}

function grow(
  state: Extract<GrowState, { status: "opening" | "closing" }>,
  event: Extract<GrowEvent, { type: "frame" }>,
) {
  const open = state.status === "opening"
  const size = open ? state.full : 0
  const spring = state.spring
  const presence = state.presence
  spring.set(size).step(event.dt)

  if (Math.abs(spring.value - size) < 0.5 && Math.abs(spring.velocity) < 5) spring.snap(size)
  const shown = open ? 1 : 0
  presence.set(shown).step(event.dt)

  if (Math.abs(presence.value - shown) < 0.01 && Math.abs(presence.velocity) < 0.05) presence.snap(shown)

  if (spring.resting && (!state.fade || !open || presence.resting)) return land(state)
  const p = clamp(spring.value / Math.max(1, state.full))
  state.height = snap(Math.max(0, spring.value), event.dpr)
  state.marginBottom = snap(state.marginBelow * p, event.dpr)
  state.marginTop = snap(-state.marginAbove * (1 - p), event.dpr)
  state.progress = open ? clamp(presence.value) : p
  state.hidden = state.card ? state.full - state.height : 0

  return state
}

function land(state: Extract<GrowState, { status: "opening" | "closing" }>): GrowState {
  return { status: state.status === "opening" ? "present" : "absent", attempt: state.attempt }
}

export function isGrowMoving(state: GrowState): state is Extract<GrowState, { status: "opening" | "closing" }> {
  return state.status === "opening" || state.status === "closing"
}

export function isGrowMounted(state: GrowState) {
  return state.status === "opening" || state.status === "present" || state.status === "closing"
}

export function isGrowInteractive(state: GrowState) {
  return state.status === "opening" || state.status === "present"
}

/** True once per close: the children have just unmounted. */
export function didGrowClose(previous: GrowState, next: GrowState) {
  return previous !== next && isGrowMounted(previous) && next.status === "absent"
}

function tune(spring: Spring, options: DurationOptions) {
  spring.omega = (2 * Math.PI) / options.duration
  spring.zeta = 1 - options.bounce

  return spring
}

const snap = (px: number, dpr: number) => Math.round(px * dpr) / dpr

const clamp = (value: number) => Math.max(0, Math.min(1, value))
