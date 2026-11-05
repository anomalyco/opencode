import { decodePersistentPtyMessage, persistentPtyFrame, type PersistentPtyMessage } from "@opencode/client/solid"
import { Option } from "effect"

export type TerminalSize = { readonly cols: number; readonly rows: number }

export type TerminalFailure = "disconnected" | "failed" | "outdated"

export type ConnectionRole = "controller" | "observer"

/**
 * A live attachment's pane. Until the pane is first measured, a click and typed input wait here, so neither is lost
 * nor sent at another client's size.
 */
export type LivePane =
  | { readonly sized: false; readonly wantsControl: boolean; readonly pendingInput: readonly Uint8Array[] }
  | { readonly sized: true; readonly size: TerminalSize }

/**
 * One WebSocket attachment to a persistent PTY. It never reconnects: after a failure the surface mounts a new terminal
 * with a new attachment and a new state.
 */
export type ConnectionState =
  /** Waiting for the socket's `attached` message; the HTTP snapshot may restore the screen meanwhile. */
  | {
      readonly status: "restoring"
      readonly attachmentID: string
      readonly desired: TerminalSize | undefined
      readonly wantsControl: boolean
      readonly pendingInput: readonly Uint8Array[]
    }
  /** Attached; the socket's replay streams, then drains through the writer. */
  | {
      readonly status: "replaying"
      readonly attachmentID: string
      readonly role: ConnectionRole
      /** `replay_complete` arrived and its end-of-replay step waits in the writer. */
      readonly replayComplete: boolean
      readonly desired: TerminalSize | undefined
      readonly wantsControl: boolean
      readonly pendingInput: readonly Uint8Array[]
    }
  /** The replay is on screen; input and size frames go out at the pane's size. */
  | {
      readonly status: "live"
      readonly attachmentID: string
      readonly role: ConnectionRole
      readonly pane: LivePane
    }
  /** The shell exited; the socket closing or erroring afterwards is no failure, and nothing more is sent. */
  | { readonly status: "exited" }
  /** Reported to the surface once. */
  | { readonly status: "failed"; readonly failure: TerminalFailure }
  | { readonly status: "disposed" }

export type ConnectionEvent =
  /** The HTTP snapshot restores the screen before the socket's output. */
  | { readonly type: "snapshot.restored"; readonly size: TerminalSize; readonly checkpoint: string }
  /** A text message from the socket, as received. */
  | { readonly type: "socket.message"; readonly text: string }
  /** The writer wrote everything queued before `replay_complete`. */
  | { readonly type: "replay.drained" }
  /** Encoded user input, without the replies the emulator makes while writing. */
  | { readonly type: "input"; readonly data: Uint8Array }
  /** The user clicked or focused the pane, which takes control at its size. */
  | { readonly type: "interacted" }
  | { readonly type: "size.changed"; readonly size: TerminalSize }
  | { readonly type: "socket.closed" }
  /** The socket errored, or setting it up failed. */
  | { readonly type: "socket.errored" }
  | { readonly type: "disposed" }

export type ConnectionEffect =
  /** Queues a canonical resize on the writer, then the base64 checkpoint, after a terminal reset when `reset`. */
  | { readonly type: "queue-resize"; readonly size: TerminalSize; readonly checkpoint?: string; readonly reset?: boolean }
  /** Queues the end of the replay on the writer, which reports `replay.drained` once the output before it is written. */
  | { readonly type: "queue-replay-end" }
  /** Sends a frame: size alone takes control, size and input types. */
  | { readonly type: "send"; readonly frame: Uint8Array<ArrayBuffer> }
  | { readonly type: "fail"; readonly failure: TerminalFailure }
  /** Drops what the writer has not written yet. */
  | { readonly type: "clear-writer" }

export type ConnectionTransition = { readonly state: ConnectionState; readonly effects: readonly ConnectionEffect[] }

type Attaching = Extract<ConnectionState, { status: "restoring" | "replaying" }>

const NONE: readonly ConnectionEffect[] = []

const EMPTY_INPUT: readonly Uint8Array[] = []

const EXITED: ConnectionState = { status: "exited" }

const DISPOSED: ConnectionState = { status: "disposed" }

export function createConnectionState(attachmentID: string): ConnectionState {
  return { status: "restoring", attachmentID, desired: undefined, wantsControl: false, pendingInput: EMPTY_INPUT }
}

export function transitionConnection(state: ConnectionState, event: ConnectionEvent): ConnectionTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: [{ type: "clear-writer" }] }

  if (event.type === "socket.message") {
    const message = decodePersistentPtyMessage(event.text)

    return Option.isSome(message) ? receive(state, message.value) : unchanged(state)
  }

  if (event.type === "snapshot.restored")
    return state.status === "restoring"
      ? { state, effects: [{ type: "queue-resize", size: event.size, checkpoint: event.checkpoint }] }
      : unchanged(state)

  if (event.type === "replay.drained") return drained(state)

  if (event.type === "input") return input(state, event.data)

  if (event.type === "interacted") return interacted(state)

  if (event.type === "size.changed") return sized(state, event.size)

  if (state.status === "exited" || state.status === "failed") return unchanged(state)

  const failure = event.type === "socket.closed" ? "disconnected" : "failed"

  return { state: { status: "failed", failure }, effects: [{ type: "fail", failure }] }
}

/** Socket output still reaches the screen until the attachment fails or unmounts; an exited shell's last output too. */
export function canAcceptOutput(state: ConnectionState) {
  return state.status !== "failed" && state.status !== "disposed"
}

function receive(state: ConnectionState, message: PersistentPtyMessage): ConnectionTransition {
  if (message.type === "attached") {
    if (state.status !== "restoring") return unchanged(state)

    if (message.inputProtocol !== 1)
      return { state: { status: "failed", failure: "outdated" }, effects: [{ type: "fail", failure: "outdated" }] }

    return {
      state: {
        status: "replaying",
        attachmentID: state.attachmentID,
        role: message.role === "controller" ? "controller" : "observer",
        replayComplete: false,
        desired: state.desired,
        wantsControl: state.wantsControl,
        pendingInput: state.pendingInput,
      },
      effects: [{ type: "queue-resize", size: message.info.size }],
    }
  }

  if (state.status !== "replaying" && state.status !== "live") return unchanged(state)

  if (message.type === "resized")
    return {
      state,
      effects: [
        {
          type: "queue-resize",
          size: { cols: message.cols, rows: message.rows },
          checkpoint: message.checkpoint,
          reset: true,
        },
      ],
    }

  if (message.type === "replay_complete")
    return state.status === "replaying" && !state.replayComplete
      ? { state: { ...state, replayComplete: true }, effects: [{ type: "queue-replay-end" }] }
      : unchanged(state)

  if (message.type === "exited") return { state: EXITED, effects: NONE }

  if (message.type !== "controller_changed") return unchanged(state)
  const role = message.attachmentID === state.attachmentID ? "controller" : "observer"

  if (role === state.role) return unchanged(state)

  if (state.status === "replaying") return { state: { ...state, role }, effects: NONE }

  return {
    state: { ...state, role },
    effects: role === "controller" && state.pane.sized ? [send(state.pane.size)] : NONE,
  }
}

function drained(state: ConnectionState): ConnectionTransition {
  if (state.status !== "replaying" || !state.replayComplete) return unchanged(state)

  const base = { status: "live", attachmentID: state.attachmentID, role: state.role } as const

  if (!state.desired)
    return {
      state: { ...base, pane: { sized: false, wantsControl: state.wantsControl, pendingInput: state.pendingInput } },
      effects: NONE,
    }

  return { state: { ...base, pane: { sized: true, size: state.desired } }, effects: flush(state.desired, state.role, state) }
}

function input(state: ConnectionState, data: Uint8Array): ConnectionTransition {
  if (data.byteLength === 0) return unchanged(state)

  if (attaching(state)) return { state: { ...state, pendingInput: [...state.pendingInput, data] }, effects: NONE }

  if (state.status !== "live") return unchanged(state)

  if (state.pane.sized) return { state, effects: [send(state.pane.size, data)] }

  return {
    state: { ...state, pane: { ...state.pane, pendingInput: [...state.pane.pendingInput, data] } },
    effects: NONE,
  }
}

function interacted(state: ConnectionState): ConnectionTransition {
  if (attaching(state))
    return state.wantsControl ? unchanged(state) : { state: { ...state, wantsControl: true }, effects: NONE }

  if (state.status !== "live") return unchanged(state)

  if (state.pane.sized) return { state, effects: [send(state.pane.size)] }

  return state.pane.wantsControl
    ? unchanged(state)
    : { state: { ...state, pane: { ...state.pane, wantsControl: true } }, effects: NONE }
}

function sized(state: ConnectionState, size: TerminalSize): ConnectionTransition {
  if (size.cols <= 0 || size.rows <= 0) return unchanged(state)

  if (attaching(state))
    return same(state.desired, size) ? unchanged(state) : { state: { ...state, desired: size }, effects: NONE }

  if (state.status !== "live") return unchanged(state)

  if (!state.pane.sized)
    return { state: { ...state, pane: { sized: true, size } }, effects: flush(size, state.role, state.pane) }

  if (same(state.pane.size, size)) return unchanged(state)

  return {
    state: { ...state, pane: { sized: true, size } },
    effects: state.role === "controller" ? [send(size)] : NONE,
  }
}

/** Sends the input held until the pane had a size, or else takes control when this attachment controls or asked to. */
function flush(
  size: TerminalSize,
  role: ConnectionRole,
  held: { readonly wantsControl: boolean; readonly pendingInput: readonly Uint8Array[] },
): readonly ConnectionEffect[] {
  if (held.pendingInput.length > 0) return held.pendingInput.map((data) => send(size, data))

  return role === "controller" || held.wantsControl ? [send(size)] : NONE
}

function attaching(state: ConnectionState): state is Attaching {
  return state.status === "restoring" || state.status === "replaying"
}

function send(size: TerminalSize, data?: Uint8Array): ConnectionEffect {
  return { type: "send", frame: persistentPtyFrame(size, data) }
}

function same(current: TerminalSize | undefined, next: TerminalSize) {
  return current?.cols === next.cols && current.rows === next.rows
}

function unchanged(state: ConnectionState): ConnectionTransition {
  return { state, effects: NONE }
}
