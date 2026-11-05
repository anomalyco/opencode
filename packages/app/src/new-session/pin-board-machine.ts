// Where a pin is: in its socket, flying, piled on the composer or floor, flying home, or knocked off the panel by the
// brick breaker ball (its socket stays empty until the game ends).
export type PinPhase = "home" | "air" | "rest" | "return" | "out"

export type Pin = {
  c: number
  r: number
  lv: number
  hx: number
  hy: number
  x: number
  y: number
  vx: number
  vy: number
  z: number
  zv: number
  e: number
  rot: number
  spin: number
  phase: PinPhase
  pop: number
  popAt: number
  bucket: number
  onComposer: boolean
  level: number
  x0: number
  y0: number
  rot0: number
  t0: number
  duration: number
  lift: number
  fd: number
  bd: number
}

// What the board does with input. Held in a plain variable and replaced whole, never in a Solid store.
export type PinBoardState =
  | {
      readonly status: "interactive"
      /** A held press keeps knocking along its path from the last knock at `dragX`, `dragY`. */
      readonly dragging: boolean
      readonly dragX: number
      readonly dragY: number
      readonly knockedAt: number
    }
  | { readonly status: "game" }
  | { readonly status: "closing"; readonly closedAt: number }
  | { readonly status: "disposed" }

export type PinBoardEvent =
  | { readonly type: "pointer.down"; readonly x: number; readonly y: number }
  | { readonly type: "pointer.dragged"; readonly x: number; readonly y: number }
  | { readonly type: "pointer.up" }
  | { readonly type: "knocked"; readonly now: number }
  | { readonly type: "play" }
  | { readonly type: "restore"; readonly now: number }
  | { readonly type: "close"; readonly now: number }
  | { readonly type: "dispose" }

const DISPOSED: PinBoardState = Object.freeze({ status: "disposed" })

export function createPinBoardState(): PinBoardState {
  return { status: "interactive", dragging: false, dragX: 0, dragY: 0, knockedAt: -99 }
}

/** Returns the same object when nothing changes, so the frame loop allocates nothing. */
export function transitionPinBoard(state: PinBoardState, event: PinBoardEvent): PinBoardState {
  if (state.status === "disposed") return state

  if (event.type === "dispose") return DISPOSED

  if (state.status === "closing") return state

  if (event.type === "close") return { status: "closing", closedAt: event.now }

  if (state.status === "game") {
    if (event.type !== "restore") return state

    return { status: "interactive", dragging: false, dragX: 0, dragY: 0, knockedAt: event.now }
  }

  if (event.type === "play") return { status: "game" }

  // The knock a press or drag makes reports its own hits through `knocked`.
  if (event.type === "pointer.down") return { ...state, dragging: true, dragX: event.x, dragY: event.y }

  if (event.type === "pointer.dragged") return state.dragging ? { ...state, dragX: event.x, dragY: event.y } : state

  if (event.type === "pointer.up") return state.dragging ? { ...state, dragging: false } : state

  if (event.type === "knocked") return { ...state, knockedAt: event.now }

  return state
}

/** Pointer input moves and knocks pins only on the interactive board, not in a game or while packing up. */
export function acceptsPointer(state: PinBoardState) {
  return state.status === "interactive"
}

export function acceptsGameInput(state: PinBoardState) {
  return state.status === "game"
}

export function isBoardDragging(state: PinBoardState) {
  return state.status === "interactive" && state.dragging
}

/** A held press knocks again once it moves far enough from its last knock to read as a trail. */
export function dragKnockDue(state: PinBoardState, x: number, y: number, pitch: number) {
  return state.status === "interactive" && state.dragging && Math.hypot(x - state.dragX, y - state.dragY) > pitch * 1.2
}

/** Loose pins fly home once they settle, or after a while even if some are still bouncing. */
export function shouldReassemble(state: PinBoardState, air: number, loose: number, now: number) {
  if (state.status !== "interactive" || state.dragging || !loose) return false
  const idle = now - state.knockedAt

  return (air === 0 && idle > 2) || idle > 6
}

export function boardCloseAge(state: PinBoardState, now: number) {
  return state.status === "closing" ? now - state.closedAt : -1
}

/**
 * Moves every socket to the new grid after a resize without changing any pin's phase, so a game, a pile or the
 * closing wave survives it. Socketed pins follow their socket; piled pins drop and pile again on the new surfaces.
 */
export function relayoutPins(pins: Pin[], x0: number, y0: number, pitch: number) {
  for (const p of pins) {
    p.hx = x0 + (p.c + 0.5) * pitch
    p.hy = y0 + (p.r + 0.5) * pitch
    if (p.phase === "home") {
      p.x = p.hx
      p.y = p.hy
      continue
    }
    if (p.phase !== "rest") continue
    p.phase = "air"
    p.vx = 0
    p.vy = 0
  }
}

export function countHomePins(pins: readonly Pin[]) {
  let n = 0
  for (const p of pins) if (p.phase === "home") n++
  return n
}

export function createPin(c: number, r: number, lv: number): Pin {
  return {
    c,
    r,
    lv,
    hx: 0,
    hy: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    z: 0,
    zv: 0,
    e: 0,
    rot: 0,
    spin: 0,
    phase: "home",
    pop: 0,
    popAt: 0,
    bucket: 0,
    onComposer: false,
    level: 0,
    x0: 0,
    y0: 0,
    rot0: 0,
    t0: 0,
    duration: 0,
    lift: 0,
    fd: 0,
    bd: 1,
  }
}
