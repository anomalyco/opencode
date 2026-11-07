import {
  canAcceptOutput,
  createConnectionState,
  transitionConnection,
  type ConnectionEffect,
  type ConnectionEvent,
  type TerminalFailure,
  type TerminalSize,
} from "./connection-machine"
import { terminalWriter } from "./writer"

export type { TerminalFailure, TerminalSize } from "./connection-machine"

const REPLAY_DRAINED: ConnectionEvent = { type: "replay.drained" }

const INTERACTED: ConnectionEvent = { type: "interacted" }

const SOCKET_CLOSED: ConnectionEvent = { type: "socket.closed" }

const SOCKET_ERRORED: ConnectionEvent = { type: "socket.errored" }

const DISPOSED: ConnectionEvent = { type: "disposed" }

// One attachment to a persistent PTY, following the TUI's terminal pane: the snapshot restores the screen, then
// socket output, canonical resizes and the end of the replay apply in order through one queue. Input goes live once
// the replay completes, and size frames take control at the pane's size. The protocol lives in `./connection-machine`;
// binary output skips it and goes straight to the writer.
export function terminalConnection(input: {
  attachmentID: string
  write: (data: Uint8Array, done: VoidFunction) => void
  resize: (size: TerminalSize) => void
  send: (frame: Uint8Array<ArrayBuffer>) => void
  fail: (failure: TerminalFailure) => void
}) {
  const encoder = new TextEncoder()
  let current = createConnectionState(input.attachmentID)
  let writing = false

  // ghostty-web answers device and color queries itself while writing and reports the replies as input, synchronously.
  // The daemon already answers them, and forwarding a reply would also take control from another client.
  const writer = terminalWriter((data, done) => {
    writing = true

    try {
      input.write(data, done)
    } finally {
      writing = false
    }
  })

  const dispatch = (event: ConnectionEvent) => {
    const next = transitionConnection(current, event)
    current = next.state
    next.effects.forEach(run)
  }

  const drained = () => dispatch(REPLAY_DRAINED)

  const run = (effect: ConnectionEffect) => {
    if (effect.type === "queue-resize") {
      const size = effect.size
      writer.push(() => input.resize(size))

      // The checkpoint is a binary string: one character per byte.
      if (effect.checkpoint !== undefined) {
        const checkpoint = (effect.reset ? "\x1bc" : "") + atob(effect.checkpoint)
        writer.push(Uint8Array.from(checkpoint, (char) => char.charCodeAt(0)))
      }

      return
    }

    if (effect.type === "queue-replay-end") return writer.push(drained)

    if (effect.type === "send") return input.send(effect.frame)

    if (effect.type === "fail") return input.fail(effect.failure)

    writer.clear()
  }

  return {
    restore(snapshot: { size: TerminalSize; checkpoint: string }) {
      dispatch({ type: "snapshot.restored", size: snapshot.size, checkpoint: snapshot.checkpoint })
    },
    output(data: Uint8Array) {
      if (canAcceptOutput(current)) writer.push(data)
    },
    message(text: string) {
      dispatch({ type: "socket.message", text })
    },
    input(data: string) {
      if (!writing) dispatch({ type: "input", data: encoder.encode(data) })
    },
    interact() {
      dispatch(INTERACTED)
    },
    size(size: TerminalSize) {
      dispatch({ type: "size.changed", size })
    },
    close() {
      dispatch(SOCKET_CLOSED)
    },
    error() {
      dispatch(SOCKET_ERRORED)
    },
    /** Stops output not yet written; the owner calls it on unmount. */
    dispose() {
      dispatch(DISPOSED)
    },
  }
}
