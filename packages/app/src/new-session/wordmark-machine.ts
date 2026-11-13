import type { PinBoardHandle } from "./pin-board"
import type { LodgerBall } from "./wordmark"

/** Pulling the lodger further than this, in logo units, pops every pin out into the pin board. */
export const LODGER_POP = 26

/** A carried lodger released closer than this to where it was picked up hops in place. */
const LODGER_TAP = 4

/**
 * The new session wordmark and the lodger that lives in its final "e". `board` is the static pin board (the
 * `pins` story) with no lodger. Pulling the lodger out (`drag`) either snaps it back (`snap`) or pops the pin board
 * out (`show`); from its perch (`idle`) it can be carried (`carry`) back into the hole (`pack`), dropped on the
 * composer to play Brick Breaker (`game`), or let go to hop home (`hop`, `return`).
 *
 * `board` holds the pin board's handle while it is mounted. `cue` counts the timed steps of an animation already
 * run, so each runs once. In `game`, `ballStage` follows the ball after Brick Breaker ends: it flies home
 * (`returning`), then waits there (`landed`) until Brick Breaker finishes its exit and unmounts.
 */
export type WordmarkState =
  | { readonly status: "board" }
  | { readonly status: "hidden" }
  | { readonly status: "drag" }
  | { readonly status: "snap" }
  | { readonly status: "show"; readonly board: PinBoardHandle | undefined; readonly cue: number }
  | { readonly status: "idle"; readonly board: PinBoardHandle | undefined }
  | { readonly status: "hop"; readonly board: PinBoardHandle | undefined; readonly cue: number }
  | { readonly status: "carry"; readonly board: PinBoardHandle | undefined; readonly over: boolean }
  | {
      readonly status: "game"
      readonly board: PinBoardHandle
      readonly ball: LodgerBall
      readonly ballStage: "active" | "returning" | "landed"
    }
  | { readonly status: "return"; readonly board: PinBoardHandle | undefined }
  | { readonly status: "pack"; readonly board: PinBoardHandle | undefined; readonly cue: number }

export type WordmarkEvent =
  | { readonly type: "board.mounted"; readonly board: PinBoardHandle }
  | { readonly type: "grab" }
  | { readonly type: "drag.slip"; readonly reducedMotion: boolean }
  /** `nearHole`: the lodger, its drop point or the pointer is within the "e" hole's pull. */
  | {
      readonly type: "release"
      readonly distance: number
      readonly nearHole: boolean
      readonly ball: LodgerBall
      readonly reducedMotion: boolean
    }
  /** Sent only when the carried lodger reaches the hole or crosses the composer's edge. */
  | { readonly type: "carry.frame"; readonly inHole: boolean; readonly over: boolean; readonly reducedMotion: boolean }
  | { readonly type: "cue.step"; readonly phase: "show" | "hop" | "pack"; readonly cue: number }
  | { readonly type: "settled"; readonly phase: "snap" | "show" | "hop" | "return" | "pack" }
  /** Brick Breaker ended and sent the ball home. */
  | { readonly type: "ball.done" }
  /** Brick Breaker finished its exit and unmounts. */
  | { readonly type: "game.done" }

export type WordmarkEffect = { readonly type: "focus.composer" }

export type WordmarkTransition = {
  readonly state: WordmarkState
  readonly effects: readonly WordmarkEffect[]
}

const BOARD: WordmarkState = Object.freeze({ status: "board" })

const HIDDEN: WordmarkState = Object.freeze({ status: "hidden" })

const DRAG: WordmarkState = Object.freeze({ status: "drag" })

const SNAP: WordmarkState = Object.freeze({ status: "snap" })

const NONE: readonly WordmarkEffect[] = Object.freeze([])

const FOCUS: readonly WordmarkEffect[] = Object.freeze([Object.freeze({ type: "focus.composer" as const })])

export function createWordmarkState(pins: boolean) {
  return pins ? BOARD : HIDDEN
}

export function transitionWordmark(state: WordmarkState, event: WordmarkEvent): WordmarkTransition {
  return { state: next(state, event), effects: event.type === "game.done" && state.status === "game" ? FOCUS : NONE }
}

function next(state: WordmarkState, event: WordmarkEvent): WordmarkState {
  if (event.type === "board.mounted") {
    if (!("board" in state) || state.board === event.board) return state

    return { ...state, board: event.board }
  }

  if (event.type === "grab") {
    if (state.status === "hidden") return DRAG

    if (state.status === "idle") return { status: "carry", board: state.board, over: false }

    return state
  }

  if (event.type === "drag.slip") return state.status === "drag" ? pop(event.reducedMotion) : state

  if (event.type === "release") return release(state, event)

  if (event.type === "carry.frame") {
    if (state.status !== "carry") return state

    if (event.inHole) return pack(state.board, event.reducedMotion)

    return state.over === event.over ? state : { ...state, over: event.over }
  }

  if (event.type === "cue.step") {
    if (state.status !== "show" && state.status !== "hop" && state.status !== "pack") return state

    if (state.status !== event.phase || event.cue <= state.cue) return state

    // The pin board unmounts once the last pin slots back in.
    if (state.status === "pack" && event.cue >= 2) return { ...state, cue: event.cue, board: undefined }

    return { ...state, cue: event.cue }
  }

  if (event.type === "settled") return settle(state, event.phase)

  if (state.status !== "game") return state

  if (event.type === "ball.done") return state.ballStage === "active" ? { ...state, ballStage: "returning" } : state

  if (state.ballStage === "returning") return { status: "return", board: state.board }

  return { status: "idle", board: state.board }
}

/** The static pin board shows no lodger. */
export function selectWordmarkLodger(state: WordmarkState) {
  return state.status !== "board"
}

/** The pin board is mounted from the moment the lodger pops it out until the last pin slots back into the "e". */
export function selectPinBoard(state: WordmarkState, logo: HTMLDivElement | undefined) {
  if (!logo || state.status === "hidden" || state.status === "drag" || state.status === "snap") return

  if (state.status === "pack" && state.cue >= 2) return

  return {
    logo,
    entrance: state.status === "board" ? ("sweep" as const) : ("chain" as const),
    closing: state.status === "pack",
  }
}

export function selectBrickBreaker(state: WordmarkState) {
  if (state.status !== "game") return

  return { board: state.board, ball: state.ball }
}

export function selectWordmarkFlatVisible(state: WordmarkState) {
  if (state.status === "show") return state.cue < 2

  return state.status === "hidden" || state.status === "drag" || state.status === "snap" || state.status === "pack"
}

/** Where the lodger can be grabbed: in the "e" counter, on its perch beside the board, or nowhere. */
export function selectWordmarkGrip(state: WordmarkState) {
  if (state.status === "hidden" || state.status === "drag" || state.status === "snap") return "hidden"

  if (state.status === "idle" || state.status === "carry" || state.status === "hop" || state.status === "return")
    return "idle"

  return "none"
}

/** Carried, returning, or in play, the lodger crosses the composer, so it is lifted above it. */
export function selectWordmarkLifted(state: WordmarkState) {
  if (state.status === "game") return state.ballStage !== "landed"

  return state.status === "carry" || state.status === "return"
}

export function selectWordmarkDropOver(state: WordmarkState) {
  return state.status === "carry" && state.over
}

export function selectWordmarkAnimating(state: WordmarkState) {
  if (state.status === "game") return state.ballStage === "returning"

  return state.status !== "board" && state.status !== "hidden" && state.status !== "idle"
}

/** The lodger follows the pointer and can be grabbed only while it rests. */
export function selectWordmarkCanInteract(state: WordmarkState) {
  return state.status === "hidden" || state.status === "idle"
}

function release(state: WordmarkState, event: Extract<WordmarkEvent, { type: "release" }>): WordmarkState {
  if (state.status === "drag") {
    if (event.distance > LODGER_POP) return pop(event.reducedMotion)

    return event.reducedMotion ? HIDDEN : SNAP
  }

  if (state.status !== "carry") return state

  if (event.distance < LODGER_TAP)
    return event.reducedMotion ? { status: "idle", board: state.board } : { status: "hop", board: state.board, cue: 0 }

  if (state.over && state.board && !event.reducedMotion)
    return { status: "game", board: state.board, ball: event.ball, ballStage: "active" }

  if (event.nearHole) return pack(state.board, event.reducedMotion)

  return event.reducedMotion ? { status: "idle", board: state.board } : { status: "return", board: state.board }
}

function pop(reducedMotion: boolean): WordmarkState {
  return reducedMotion ? { status: "idle", board: undefined } : { status: "show", board: undefined, cue: 0 }
}

function pack(board: PinBoardHandle | undefined, reducedMotion: boolean): WordmarkState {
  return reducedMotion ? HIDDEN : { status: "pack", board, cue: 0 }
}

function settle(state: WordmarkState, phase: Extract<WordmarkEvent, { type: "settled" }>["phase"]): WordmarkState {
  if (phase === "return" && state.status === "game")
    return state.ballStage === "returning" ? { ...state, ballStage: "landed" } : state

  if (state.status !== phase) return state

  if (state.status === "snap" || state.status === "pack") return HIDDEN

  if (state.status === "show" || state.status === "hop" || state.status === "return")
    return { status: "idle", board: state.board }

  return state
}
