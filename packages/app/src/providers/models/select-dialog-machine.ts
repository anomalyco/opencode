// ── Desktop model dialog: the variant flyout beside the highlighted row ────────

/** How long the pointer rests on a row before its flyout opens, unless a flyout was just open. */
export const FLYOUT_OPEN_DELAY_MS = 100

/** How long the pointer may rest on a row inside the safe triangle before the flyout moves to that row. */
export const FLYOUT_AIM_TIMEOUT_MS = 300

/** How long after a flyout closes that the next row's flyout still opens at once. */
export const FLYOUT_WARM_MS = 300

export const FLYOUT_WIDTH_PX = 160

export const FLYOUT_GAP_PX = 6

export type FlyoutPoint = { readonly x: number; readonly y: number }

export type FlyoutPosition = { readonly left: number; readonly top: number }

export type FlyoutRect = {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** Where the pointer last rested on the flyout's row: the apex of the triangle that keeps the flyout open. */
type Apex = { x: number; y: number }

export type DialogFlyoutState =
  /** `input` is what moved the highlight last; `warm` holds for a moment after a flyout closes under the pointer. */
  | {
      readonly status: "closed"
      readonly attempt: number
      readonly input: "keyboard" | "pointer"
      readonly warm: boolean
    }
  /** The pointer rests on row `id`; its flyout opens after the delay. */
  | { readonly status: "opening"; readonly attempt: number; readonly id: string; readonly apex: Apex }
  /** `position` is undefined only until the driver measures the row, within the same dispatch. */
  | {
      readonly status: "open"
      readonly attempt: number
      readonly id: string
      readonly position: FlyoutPosition | undefined
      readonly apex: Apex
    }
  /** The pointer crossed onto row `target` on its way to the flyout; the flyout stays on `id` while it keeps moving. */
  | {
      readonly status: "aiming"
      readonly attempt: number
      readonly id: string
      readonly position: FlyoutPosition | undefined
      readonly apex: Apex
      readonly target: string
    }
  | { readonly status: "disposed" }

export type DialogFlyoutEvent =
  /** Arrow keys, typing, a favorite toggled or a variant staged from the keyboard. */
  | { readonly type: "keyboard" }
  | { readonly type: "wheel" }
  | {
      readonly type: "row.moved"
      readonly id: string
      readonly activeId: string | undefined
      readonly point: FlyoutPoint
      readonly flyout: FlyoutRect | undefined
    }
  | {
      readonly type: "row.left"
      readonly into: "row" | "flyout" | "outside"
      readonly point: FlyoutPoint
      readonly flyout: FlyoutRect | undefined
    }
  /** The pointer moved somewhere other than a row or the flyout while a flyout is open. */
  | { readonly type: "pointer.outside"; readonly point: FlyoutPoint; readonly flyout: FlyoutRect | undefined }
  | { readonly type: "flyout.entered" }
  /** The flyout's row moved or vanished without the pointer: a resize, a favorite toggled from the flyout. */
  | { readonly type: "dismissed" }
  /** Rows scrolled under the pointer; `target` is the row now under it, if the pointer drives the highlight. */
  | { readonly type: "scrolled"; readonly target: { readonly id: string; readonly point: FlyoutPoint } | undefined }
  | { readonly type: "placed"; readonly attempt: number; readonly position: FlyoutPosition | undefined }
  | { readonly type: "open.due"; readonly attempt: number }
  | { readonly type: "aim.due"; readonly attempt: number; readonly point: FlyoutPoint | undefined }
  | { readonly type: "warm.expired"; readonly attempt: number }
  | { readonly type: "disposed" }

export type DialogFlyoutEffect =
  | { readonly type: "activate"; readonly id: string }
  | {
      readonly type: "schedule"
      readonly kind: "open" | "aim" | "warm"
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "cancel" }
  /** Measure row `id` and answer with `placed`. */
  | { readonly type: "place"; readonly attempt: number; readonly id: string }

export type DialogFlyoutTransition = {
  readonly state: DialogFlyoutState
  readonly effects: readonly DialogFlyoutEffect[]
}

type LiveFlyout = Exclude<DialogFlyoutState, { status: "disposed" }>

const NO_EFFECTS: readonly DialogFlyoutEffect[] = []

const CANCEL: readonly DialogFlyoutEffect[] = [{ type: "cancel" }]

export function createDialogFlyoutState(): DialogFlyoutState {
  return { status: "closed", attempt: 0, input: "keyboard", warm: false }
}

export function transitionDialogFlyout(state: DialogFlyoutState, event: DialogFlyoutEvent): DialogFlyoutTransition {
  if (state.status === "disposed") return same(state)

  const cancel = timed(state) ? CANCEL : NO_EFFECTS
  const attempt = timed(state) ? state.attempt + 1 : state.attempt

  switch (event.type) {
    case "disposed":
      return { state: { status: "disposed" }, effects: cancel }
    case "keyboard":
      if (state.status === "closed" && state.input === "keyboard" && !state.warm) return same(state)

      return { state: { status: "closed", attempt, input: "keyboard", warm: false }, effects: cancel }
    case "wheel":
      if (state.status !== "closed" || state.input !== "keyboard") return same(state)

      return same({ ...state, input: "pointer" })
    case "row.moved":
      return moved(state, event)
    case "row.left": {
      if (state.status === "opening")
        return { state: { status: "closed", attempt, input: "pointer", warm: false }, effects: cancel }

      if (state.status !== "open" && state.status !== "aiming") return same(state)

      // The row the pointer enters decides.
      if (event.into === "row") return same(state)

      if (event.into === "flyout" || inside(event.point, state.apex, event.flyout)) return settle(state)

      return cool(state)
    }

    case "pointer.outside":
      if (state.status !== "open" && state.status !== "aiming") return same(state)

      if (inside(event.point, state.apex, event.flyout)) return same(state)

      return cool(state)
    case "flyout.entered":
      return settle(state)
    case "dismissed":
      if (state.status === "closed" && !state.warm) return same(state)

      return {
        state: { status: "closed", attempt, input: state.status === "closed" ? state.input : "pointer", warm: false },
        effects: cancel,
      }
    case "scrolled": {
      // Scrolled by the arrow keys: the highlight stays, and nothing opens.
      if (state.status === "closed" && state.input === "keyboard") return same(state)

      if (!event.target) return transitionDialogFlyout(state, { type: "dismissed" })

      if (state.status === "open" && state.id === event.target.id)
        return { state, effects: [{ type: "place", attempt: state.attempt, id: state.id }] }

      return show(state, event.target.id, event.target.point)
    }

    case "placed":
      if (state.status !== "open" || state.attempt !== event.attempt) return same(state)

      if (!event.position)
        return { state: { status: "closed", attempt, input: "pointer", warm: false }, effects: NO_EFFECTS }

      if (state.position?.left === event.position.left && state.position.top === event.position.top) return same(state)

      return same({ ...state, position: event.position })
    case "open.due":
      if (state.status !== "opening" || state.attempt !== event.attempt) return same(state)

      return {
        state: { status: "open", attempt: state.attempt, id: state.id, position: undefined, apex: state.apex },
        effects: [{ type: "place", attempt: state.attempt, id: state.id }],
      }
    case "aim.due": {
      if (state.status !== "aiming" || state.attempt !== event.attempt) return same(state)
      const point = event.point ?? state.apex
      const next = state.attempt + 1

      return {
        state: {
          status: "open",
          attempt: next,
          id: state.target,
          position: state.position,
          apex: { x: point.x, y: point.y },
        },
        effects: [
          { type: "activate", id: state.target },
          { type: "place", attempt: next, id: state.target },
        ],
      }
    }

    case "warm.expired":
      if (state.status !== "closed" || !state.warm || state.attempt !== event.attempt) return same(state)

      return same({ ...state, warm: false })
  }
}

function moved(state: LiveFlyout, event: Extract<DialogFlyoutEvent, { type: "row.moved" }>): DialogFlyoutTransition {
  const open = state.status === "open" || state.status === "aiming"

  // On its way to the flyout, the pointer crosses other rows without taking the flyout with it.
  if (open && event.id !== state.id && inside(event.point, state.apex, event.flyout)) {
    // Each move restarts the wait: the flyout moves only once the pointer rests on the row.
    if (state.status === "aiming" && state.target === event.id)
      return {
        state,
        effects: [{ type: "schedule", kind: "aim", attempt: state.attempt, delayMs: FLYOUT_AIM_TIMEOUT_MS }],
      }
    const attempt = state.attempt + 1

    return {
      state: {
        status: "aiming",
        attempt,
        id: state.id,
        position: state.position,
        apex: state.apex,
        target: event.id,
      },
      effects: [{ type: "schedule", kind: "aim", attempt, delayMs: FLYOUT_AIM_TIMEOUT_MS }],
    }
  }

  // Back on the flyout's own row: the pointer becomes the triangle's apex again.
  if ((state.status === "open" || state.status === "opening") && state.id === event.id && event.activeId === event.id) {
    state.apex.x = event.point.x
    state.apex.y = event.point.y

    return same(state)
  }

  if (state.status === "aiming" && state.id === event.id) {
    const attempt = state.attempt + 1

    return {
      state: {
        status: "open",
        attempt,
        id: state.id,
        position: state.position,
        apex: { x: event.point.x, y: event.point.y },
      },
      effects: event.activeId === event.id ? CANCEL : [...CANCEL, { type: "activate", id: event.id }],
    }
  }

  if (warm(state)) return show(state, event.id, event.point)
  const attempt = state.attempt + 1

  return {
    state: { status: "opening", attempt, id: event.id, apex: { x: event.point.x, y: event.point.y } },
    effects: [
      ...(timed(state) ? CANCEL : NO_EFFECTS),
      { type: "activate", id: event.id },
      { type: "schedule", kind: "open", attempt, delayMs: FLYOUT_OPEN_DELAY_MS },
    ],
  }
}

/** Opens the flyout on row `id` at once. An open flyout keeps its place until the new row is measured. */
function show(state: LiveFlyout, id: string, point: FlyoutPoint): DialogFlyoutTransition {
  const attempt = state.attempt + 1
  const position = state.status === "open" || state.status === "aiming" ? state.position : undefined

  return {
    state: { status: "open", attempt, id, position, apex: { x: point.x, y: point.y } },
    effects: [...(timed(state) ? CANCEL : NO_EFFECTS), { type: "activate", id }, { type: "place", attempt, id }],
  }
}

/** The pointer reached the flyout or rests in its triangle: a pending move to another row is called off. */
function settle(state: LiveFlyout): DialogFlyoutTransition {
  if (state.status !== "aiming") return same(state)

  return {
    state: {
      status: "open",
      attempt: state.attempt + 1,
      id: state.id,
      position: state.position,
      apex: { x: state.apex.x, y: state.apex.y },
    },
    effects: CANCEL,
  }
}

/** The pointer left the flyout behind: it closes, and the next row's flyout opens at once for a moment. */
function cool(state: LiveFlyout): DialogFlyoutTransition {
  const attempt = state.attempt + 1

  return {
    state: { status: "closed", attempt, input: "pointer", warm: true },
    effects: [{ type: "schedule", kind: "warm", attempt, delayMs: FLYOUT_WARM_MS }],
  }
}

function same(state: DialogFlyoutState): DialogFlyoutTransition {
  return { state, effects: NO_EFFECTS }
}

function timed(state: LiveFlyout) {
  return state.status === "opening" || state.status === "aiming" || (state.status === "closed" && state.warm)
}

function warm(state: LiveFlyout) {
  return state.status === "open" || state.status === "aiming" || (state.status === "closed" && state.warm)
}

/** The row whose flyout shows, once it has a position. */
export function selectFlyoutOpenId(state: DialogFlyoutState) {
  if (state.status !== "open" && state.status !== "aiming") return undefined

  return state.position ? state.id : undefined
}

/** Whether scrolling moves the highlight and flyout to the row under the pointer; a keyboard scroll keeps both. */
export function selectFlyoutFollowsPointer(state: DialogFlyoutState) {
  return state.status !== "disposed" && (state.status !== "closed" || state.input === "pointer")
}

export function selectFlyoutPosition(state: DialogFlyoutState) {
  if (state.status !== "open" && state.status !== "aiming") return undefined

  return state.position
}

/**
 * 6px beside the row's end edge, else its start edge, else over the layer: always inside the layer that holds it.
 */
export function placeFlyout(row: FlyoutRect, layer: FlyoutRect | undefined, rtl: boolean): FlyoutPosition {
  const fits = (x: number) => !layer || (x >= layer.left && x + FLYOUT_WIDTH_PX <= layer.right)
  const end = rtl ? row.left - FLYOUT_GAP_PX - FLYOUT_WIDTH_PX : row.right + FLYOUT_GAP_PX
  const start = rtl ? row.right + FLYOUT_GAP_PX : row.left - FLYOUT_GAP_PX - FLYOUT_WIDTH_PX
  const over = layer ? Math.max(layer.left, Math.min(end, layer.right - FLYOUT_WIDTH_PX)) : end
  const left = fits(end) ? end : fits(start) ? start : over

  return { left, top: row.top - 2 }
}

/**
 * A fixed element is placed against the viewport unless an ancestor contains it, as a component preview that holds
 * its dialogs does. Corrects by where it landed.
 */
export function correctFlyoutPosition(target: FlyoutPosition, placed: FlyoutPoint): FlyoutPosition {
  if (placed.x === target.left && placed.y === target.top) return target

  return { left: target.left * 2 - placed.x, top: target.top * 2 - placed.y }
}

/**
 * Whether `point` lies in the triangle from the apex to the flyout's near corners, as on macOS. Allocation-free: it
 * runs on every pointer move while a flyout is open.
 */
export function inside(point: FlyoutPoint, apex: FlyoutPoint, flyout: FlyoutRect | undefined) {
  if (!flyout) return false
  const x = flyout.left > apex.x ? flyout.left : flyout.right
  const a = side(point, apex.x, apex.y, x, flyout.top)
  const b = side(point, x, flyout.top, x, flyout.bottom)
  const c = side(point, x, flyout.bottom, apex.x, apex.y)

  return !((a < 0 || b < 0 || c < 0) && (a > 0 || b > 0 || c > 0))
}

function side(point: FlyoutPoint, ax: number, ay: number, bx: number, by: number) {
  return (point.x - bx) * (ay - by) - (ax - bx) * (point.y - by)
}

// ── Mobile model drawer: close first, then act ───────────────────────────────

/** Longer than the drawer's 200ms close transition: the deferred action runs even if its end is never reported. */
export const DRAWER_CLOSE_TIMEOUT_MS = 600

export type ModelDrawerAction = "select" | "manage" | "connect"

export type ModelDrawerState =
  /** Never opened: the drawer is not mounted yet. */
  | { readonly status: "unloaded" }
  | { readonly status: "closed"; readonly attempt: number; readonly restoreTrigger: boolean }
  | { readonly status: "open"; readonly attempt: number }
  /** The close transition runs; `action` waits for it to end. */
  | { readonly status: "closing"; readonly attempt: number; readonly action: ModelDrawerAction | undefined }
  | { readonly status: "disposed" }

export type ModelDrawerEvent =
  | { readonly type: "opened" }
  | { readonly type: "dismissed" }
  | { readonly type: "action.selected"; readonly action: ModelDrawerAction }
  | { readonly type: "hidden" }
  | { readonly type: "close.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ModelDrawerEffect =
  | { readonly type: "schedule-close-timeout"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-close-timeout" }
  | { readonly type: "run-action"; readonly action: ModelDrawerAction }

export type ModelDrawerTransition = {
  readonly state: ModelDrawerState
  readonly effects: readonly ModelDrawerEffect[]
}

const NO_DRAWER_EFFECTS: readonly ModelDrawerEffect[] = []

export function createModelDrawerState(): ModelDrawerState {
  return { status: "unloaded" }
}

export function transitionModelDrawer(state: ModelDrawerState, event: ModelDrawerEvent): ModelDrawerTransition {
  if (state.status === "disposed") return { state, effects: NO_DRAWER_EFFECTS }

  switch (event.type) {
    case "disposed":
      return {
        state: { status: "disposed" },
        effects: state.status === "closing" ? [{ type: "cancel-close-timeout" }] : NO_DRAWER_EFFECTS,
      }
    case "opened":
      if (state.status === "open") return { state, effects: NO_DRAWER_EFFECTS }

      if (state.status === "unloaded") return { state: { status: "open", attempt: 1 }, effects: NO_DRAWER_EFFECTS }

      // Reopened before the close transition ended: the action it was waiting for is called off.
      return {
        state: { status: "open", attempt: state.attempt + 1 },
        effects: state.status === "closing" ? [{ type: "cancel-close-timeout" }] : NO_DRAWER_EFFECTS,
      }
    case "dismissed":
    case "action.selected": {
      if (state.status !== "open") return { state, effects: NO_DRAWER_EFFECTS }
      const attempt = state.attempt + 1

      return {
        state: { status: "closing", attempt, action: event.type === "action.selected" ? event.action : undefined },
        effects: [{ type: "schedule-close-timeout", attempt, delayMs: DRAWER_CLOSE_TIMEOUT_MS }],
      }
    }

    case "hidden":
      if (state.status !== "closing") return { state, effects: NO_DRAWER_EFFECTS }

      return closed(state, [{ type: "cancel-close-timeout" }])
    case "close.timed-out":
      if (state.status !== "closing" || state.attempt !== event.attempt) return { state, effects: NO_DRAWER_EFFECTS }

      return closed(state, NO_DRAWER_EFFECTS)
  }
}

function closed(
  state: Extract<ModelDrawerState, { status: "closing" }>,
  effects: readonly ModelDrawerEffect[],
): ModelDrawerTransition {
  return {
    // An action takes focus elsewhere, so focus returns to the trigger only after a plain dismiss.
    state: { status: "closed", attempt: state.attempt, restoreTrigger: state.action === undefined },
    effects: state.action ? [...effects, { type: "run-action", action: state.action }] : effects,
  }
}

export function selectDrawerLoaded(state: ModelDrawerState) {
  return state.status !== "unloaded"
}

export function selectDrawerOpen(state: ModelDrawerState) {
  return state.status === "open"
}

export function selectDrawerRestoreTrigger(state: ModelDrawerState) {
  if (state.status === "closing") return state.action === undefined

  if (state.status === "closed") return state.restoreTrigger

  return true
}
