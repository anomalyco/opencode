import { decodePersistentPtyMessage, persistentPtyFrame } from "@opencode/client/solid"
import { Option } from "effect"
import { terminalWriter } from "./writer"

export type TerminalSize = { cols: number; rows: number }

export type TerminalFailure = "disconnected" | "failed" | "outdated"

// One attachment to a persistent PTY, following the TUI's terminal pane: the snapshot restores the screen, then
// socket output, canonical resizes and the end of the replay apply in order through one queue. Input goes live once
// the replay completes, and size frames take control at the pane's size.
export function terminalConnection(input: {
  attachmentID: string
  write: (data: Uint8Array, done: VoidFunction) => void
  resize: (size: TerminalSize) => void
  send: (frame: Uint8Array<ArrayBuffer>) => void
  fail: (failure: TerminalFailure) => void
}) {
  const encoder = new TextEncoder()
  const pendingInput: Uint8Array[] = []
  let attached = false
  let controller = false
  let restored = false
  let wantsControl = false
  let exited = false
  let failed = false
  let writing = false
  let canonical: TerminalSize | undefined
  let desired: TerminalSize | undefined

  // ghostty-web answers device and color queries itself while writing and reports the replies as input. The daemon
  // already answers them, and forwarding a reply would also take control from another client.
  const output = terminalWriter((data, done) => {
    writing = true
    input.write(data, done)
    writing = false
  })

  const send = (frame: Uint8Array<ArrayBuffer>) => {
    if (attached && !failed) input.send(frame)
  }

  const interact = () => {
    if (!restored) {
      wantsControl = true

      return
    }

    if (desired) send(persistentPtyFrame(desired))
  }

  const sendInput = (data: Uint8Array) => {
    if (!restored) {
      pendingInput.push(data)

      return
    }

    const size = desired ?? canonical

    if (size) send(persistentPtyFrame(size, data))
  }

  // The checkpoint is a binary string: one character per byte.
  const resize = (size: TerminalSize, checkpoint?: string) => {
    output.push(() => {
      canonical = size
      input.resize(size)
    })

    if (checkpoint !== undefined) output.push(Uint8Array.from(checkpoint, (char) => char.charCodeAt(0)))
  }

  const fail = (failure: TerminalFailure) => {
    if (failed) return
    failed = true
    input.fail(failure)
  }

  const message = (text: string) => {
    const decoded = decodePersistentPtyMessage(text)

    if (Option.isNone(decoded)) return
    const next = decoded.value

    if (next.type === "attached") {
      if (next.inputProtocol !== 1) {
        fail("outdated")

        return
      }

      resize(next.info.size)
      controller = next.role === "controller"
      attached = true

      return
    }

    if (next.type === "resized") {
      resize({ cols: next.cols, rows: next.rows }, `\x1bc${atob(next.checkpoint)}`)

      return
    }

    if (next.type === "replay_complete") {
      output.push(() => {
        restored = true
        const queued = pendingInput.splice(0)
        queued.forEach(sendInput)

        if (!queued.length && (controller || wantsControl)) interact()
        wantsControl = false
      })

      return
    }

    if (next.type === "controller_changed") {
      const previous = controller
      controller = next.attachmentID === input.attachmentID

      if (controller && !previous && restored) interact()

      return
    }

    if (next.type === "exited") exited = true
  }

  return {
    restore(snapshot: { size: TerminalSize; checkpoint: string }) {
      resize(snapshot.size, atob(snapshot.checkpoint))
    },
    output(data: Uint8Array) {
      output.push(data)
    },
    message,
    input(data: string) {
      if (writing) return
      sendInput(encoder.encode(data))
    },
    interact,
    size(next: TerminalSize) {
      if (desired?.cols === next.cols && desired.rows === next.rows) return
      desired = next

      if (controller && restored) interact()
    },
    close() {
      if (!exited) fail("disconnected")
    },
    error() {
      fail("failed")
    },
  }
}
