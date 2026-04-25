import { decodePasteBytes, StdinParser } from "@opentui/core"

/**
 * Captures input typed before the prompt UI appears so users can start typing immediately.
 */
export type StartupInputBuffer = ReturnType<typeof createStartupInputBuffer>
export type StartupInputBufferState = ReturnType<typeof createStartupInputBufferState>

const encoder = new TextEncoder()

export function createStartupInputBufferState() {
  return {
    input: "",
    // Keep parsing synchronous; startup capture should not own timers.
    parser: new StdinParser({ armTimeouts: false }),
  }
}

export function appendStartupInputBufferChunk(state: StartupInputBufferState, chunk: string | Uint8Array) {
  state.parser.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk)
  state.parser.drain((event) => {
    if (event.type === "response") return
    if (event.type === "paste") {
      state.input += decodePasteBytes(event.bytes)
      return
    }
    if (event.type !== "key") return

    // Backspace/delete edit buffered startup text.
    if (event.key.name === "backspace" || event.key.name === "delete") {
      state.input = dropLast(state.input)
      return
    }

    // Ctrl+U clears the startup buffer.
    if (event.key.ctrl && event.key.name === "u") {
      state.input = ""
      return
    }

    // Enter before the prompt appears should not submit anything.
    if (event.key.name === "return") return

    // Preserve pasted newlines and append normal typed characters.
    if (event.key.name === "linefeed" || (!event.key.ctrl && !event.key.meta && Array.from(event.raw).length === 1)) {
      state.input += event.raw
    }
  })

  return state
}

export function createStartupInputBuffer() {
  const state = createStartupInputBufferState()
  let disposed = false

  const onData = (data: Buffer | string) => {
    appendStartupInputBufferChunk(state, data)
  }

  if (process.stdin.isTTY) process.stdin.on("data", onData)

  return {
    drain() {
      const result = state.input
      state.input = ""
      return result
    },
    dispose() {
      if (disposed) return
      disposed = true
      process.stdin.off("data", onData)
      state.parser.destroy()
    },
  }
}

function dropLast(input: string) {
  return Array.from(input).slice(0, -1).join("")
}
