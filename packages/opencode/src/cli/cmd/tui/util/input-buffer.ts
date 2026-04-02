type Emit = typeof process.stdin.emit

let buffer: Buffer[] = []
let emit: Emit | undefined
let live = false
let paste = false
let sink: (() => void) | undefined

const PASTE_START = Buffer.from("\x1b[200~")
const PASTE_END = Buffer.from("\x1b[201~")

// Split raw bytes into chunks at control/escape boundaries so each gets a
// separate push/drain cycle in opentui's StdinParser. Printable runs stay
// together; each control byte or escape sequence becomes its own chunk.
// Bracketed paste (ESC[200~ ... ESC[201~) is kept as one atomic chunk so
// the paste event fires in a single drain cycle.
// Returns {chunk, paste} tuples so flush() knows which chunks need an
// async yield afterward (paste handlers do async I/O like reading images).
function split(data: Buffer): { chunk: Buffer; paste: boolean }[] {
  const out: { chunk: Buffer; paste: boolean }[] = []
  let i = 0
  let text = i // start of current printable run
  while (i < data.length) {
    const b = data[i]
    if (b === 0x1b) {
      if (i > text) out.push({ chunk: data.subarray(text, i), paste: false })
      const start = i
      // Check for bracketed paste start
      if (data.length - i >= PASTE_START.length && data.subarray(i, i + PASTE_START.length).equals(PASTE_START)) {
        i += PASTE_START.length
        // Scan for paste end marker
        while (i < data.length) {
          if (data.length - i >= PASTE_END.length && data.subarray(i, i + PASTE_END.length).equals(PASTE_END)) {
            i += PASTE_END.length
            break
          }
          i++
        }
        out.push({ chunk: data.subarray(start, i), paste: true })
        text = i
        continue
      }
      i++ // consume ESC
      if (i < data.length) {
        const next = data[i]
        if (next === 0x5b) {
          // CSI: ESC [ <params> <final 0x40-0x7E>
          i++
          while (i < data.length && data[i] < 0x40) i++
          if (i < data.length) i++ // final byte
        } else if (next === 0x5d) {
          // OSC: ESC ] ... (ST = ESC \ or BEL = 0x07)
          i++
          while (i < data.length) {
            if (data[i] === 0x07) {
              i++
              break
            }
            if (data[i] === 0x1b && i + 1 < data.length && data[i + 1] === 0x5c) {
              i += 2
              break
            }
            i++
          }
        } else {
          // Two-byte sequence (SS2, SS3, or simple ESC+char)
          i++
        }
      }
      out.push({ chunk: data.subarray(start, i), paste: false })
      text = i
    } else if (b < 0x20) {
      // Single control byte (Ctrl+A, Enter, Tab, etc.)
      if (i > text) out.push({ chunk: data.subarray(text, i), paste: false })
      out.push({ chunk: data.subarray(i, i + 1), paste: false })
      i++
      text = i
    } else {
      i++
    }
  }
  if (i > text) out.push({ chunk: data.subarray(text, i), paste: false })
  return out
}

export namespace InputBuffer {
  export function install() {
    if (live) return

    const input = process.stdin
    if (process.stdout.isTTY && !paste) {
      // Enable bracketed paste before opentui boots so startup pastes are
      // tagged as paste events instead of collapsing into plain text.
      process.stdout.write("\x1b[?2004h")
      paste = true
    }
    // Raw mode makes keystrokes arrive individually instead of waiting for
    // Enter (cooked/line mode). Without this, early input is line-buffered
    // and never reaches us.
    if (input.isTTY) input.setRawMode(true)
    emit = input.emit.bind(input)
    // A no-op data listener keeps the stream flowing. Without at least one
    // listener, Node pauses the stream and no data events are emitted.
    sink = () => {}
    input.on("data", sink)
    input.resume()
    live = true
    buffer = []

    // Patch emit to intercept "data" events. All events are forwarded to
    // existing listeners (so theme detection, terminal queries etc. work
    // normally). Every chunk is also copied into the buffer. No filtering
    // happens here; opentui's StdinParser handles escape sequences properly,
    // classifying terminal responses as harmless "response" events while
    // preserving user actions (bracketed paste, arrow keys, Ctrl combos).
    input.emit = ((event: string | symbol, ...args: unknown[]) => {
      if (!live || event !== "data") return emit!(event, ...args)

      const chunk = args[0]
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      if (Buffer.isBuffer(data) && data.length > 0) buffer.push(Buffer.from(data))

      return emit!(event, ...args)
    }) as Emit
  }

  // Called once the prompt is mounted and ready to receive input. Restores
  // original emit, then replays buffered chunks individually so opentui's
  // StdinParser runs a separate push/drain cycle per chunk. This keeps
  // cursor position accurate: text is inserted first, then the paste event
  // fires while the cursor is still at the paste site (not at end of input).
  // Paste chunks get an async yield afterward because the prompt's onPaste
  // handler does async I/O (reading image files from disk) before inserting
  // the [Image N] marker. Without the yield, subsequent text chunks would
  // be emitted before the paste handler finishes, moving the cursor past
  // the paste site.
  export async function flush() {
    if (!live || !emit) return

    const input = process.stdin
    const next = emit
    const data = buffer.length > 0 ? Buffer.concat(buffer) : null
    buffer = []
    live = false
    input.emit = next
    emit = undefined

    if (!data || data.length === 0) return
    for (const entry of split(data)) {
      next("data", entry.chunk)
      // Yield after paste chunks so async paste handlers (image read, base64
      // encode) complete before the next chunk moves the cursor.
      if (entry.paste) await new Promise((r) => setTimeout(r, 100))
    }
  }

  export function pending() {
    return buffer.reduce((n, b) => n + b.length, 0)
  }

  export function uninstall() {
    buffer = []
    live = false

    if (paste && process.stdout.isTTY) {
      process.stdout.write("\x1b[?2004l")
      paste = false
    }

    if (emit) {
      process.stdin.emit = emit
      emit = undefined
    }

    if (sink) {
      process.stdin.removeListener("data", sink)
      sink = undefined
    }
  }
}
