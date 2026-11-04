// A fake persistent PTY socket for P-APP (E.13a). The TS TUI opens `new WebSocket(url)` with no way to pass a
// socket in (src/context/client.tsx builds the PTY client from the URL alone), and the fixture's server cannot
// upgrade, so scenarios.test.tsx swaps the global WebSocket for persistent PTY URLs while a scenario with `pty` runs.
//
// The fake is a tiny shell: it attaches as controller at the snapshot's size, replays `replay`, echoes input (a
// carriage return becomes a line break), and answers a size change with `resized` and a checkpoint of everything it
// printed. It records the URL, the frames it got, and every message it sent with the step and frame count it was
// sent at, so crates/tui/tests/all/app.rs can replay the same exchange to the Rust TUI.

export type PtyScript = {
  // The snapshot's size, which the server attaches at.
  size: { cols: number; rows: number }
  // The snapshot's checkpoint text; the fake's screen starts with it.
  checkpoint: string
  // Output replayed after attaching, before `replay_complete`.
  replay: string
}

export type PtyStep = { output: string } | { close: true }

export type SocketRecording = {
  path: string
  query: Record<string, string>
  // Each frame the client sent, with the step it arrived in.
  sent: { step: number; frame: number[] }[]
  // Each message the fake sent: after `after` client frames, in step `step`.
  received: ({ step: number; after: number } & ({ text: string } | { binary: string } | { close: true }))[]
}

const PTY_PATH = /\/api\/experimental\/persistent-pty\/[^/]+\/connect$/

export function installFakePty(script: PtyScript, currentStep: () => number) {
  const original = globalThis.WebSocket
  const sockets: FakeSocket[] = []
  const recordings: SocketRecording[] = []

  class FakeSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = 1
    binaryType = "arraybuffer"
    size = script.size
    screen = script.checkpoint
    recording: SocketRecording

    constructor(url: URL) {
      super()
      this.recording = {
        path: url.pathname,
        // The attachment ID is random on both sides.
        query: Object.fromEntries(
          [...url.searchParams].map(([key, value]) => [key, key === "attachment_id" ? "<attachment>" : value]),
        ),
        sent: [],
        received: [],
      }
      recordings.push(this.recording)
      sockets.push(this)
      setTimeout(() => {
        this.text({ type: "attached", inputProtocol: 1, info: { size: this.size }, role: "controller" })
        this.print(script.replay)
        this.text({ type: "replay_complete" })
      }, 0)
    }

    send(data: ArrayBuffer | Uint8Array) {
      const frame = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset))
      this.recording.sent.push({ step: currentStep(), frame: [...frame] })
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
      const size = { cols: view.getUint16(1), rows: view.getUint16(3) }
      setTimeout(() => {
        if (this.readyState !== 1) return
        if (size.cols !== this.size.cols || size.rows !== this.size.rows) {
          this.size = size
          this.text({ type: "resized", cols: size.cols, rows: size.rows, checkpoint: Buffer.from(this.screen).toString("base64") })
        }
        if (frame[0] === 1 && frame.length > 5)
          this.print(new TextDecoder().decode(frame.slice(5)).replaceAll("\r", "\r\n"))
      }, 0)
    }

    close() {
      this.readyState = 3
    }

    step(step: PtyStep) {
      if ("output" in step) return this.print(step.output)
      this.log({ close: true })
      this.readyState = 3
      this.dispatchEvent(new Event("close"))
    }

    print(text: string) {
      if (!text) return
      this.screen += text
      this.log({ binary: Buffer.from(text).toString("base64") })
      this.dispatch(new TextEncoder().encode(text).buffer)
    }

    text(message: object) {
      const text = JSON.stringify(message)
      this.log({ text })
      this.dispatch(text)
    }

    log(message: { text: string } | { binary: string } | { close: true }) {
      this.recording.received.push({ step: currentStep(), after: this.recording.sent.length, ...message })
    }

    dispatch(data: string | ArrayBuffer) {
      if (this.readyState !== 1) return
      this.dispatchEvent(new MessageEvent("message", { data }))
    }
  }

  globalThis.WebSocket = new Proxy(original, {
    construct(target, args) {
      const url = new URL(String(args[0]))
      if (PTY_PATH.test(url.pathname)) return new FakeSocket(url)
      return Reflect.construct(target, args)
    },
  }) as typeof WebSocket

  return {
    recordings,
    // A scenario step for the newest socket.
    step(step: PtyStep) {
      sockets.at(-1)?.step(step)
    },
    restore() {
      globalThis.WebSocket = original
    },
  }
}
