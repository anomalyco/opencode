export type CursorShape = {
  style: "block" | "underline" | "bar"
  blink: boolean
}

const ESCAPE = 0x1b
const BRACKET = 0x5b
const SPACE = 0x20
const Q = 0x71
const MAX_SEQUENCE = 16

// Neovim and other full-screen programs ask for a cursor shape with DECSCUSR
// (`CSI Ps SP q`). ghostty-web's parser records the shape, but its render state
// reports a fixed block cursor, so mirror the sequence onto the terminal options.
// This can move into ghostty-web once it exposes the cursor style and blink state.
export function createCursorShapeReader(read: (shape: CursorShape) => void) {
  let pending: number[] = []

  return (data: Uint8Array) => {
    for (const byte of data) {
      if (pending.length === 0) {
        if (byte === ESCAPE) pending = [ESCAPE]
        continue
      }

      if (pending.length === 1) {
        if (byte === BRACKET) pending.push(BRACKET)
        else if (byte !== ESCAPE) pending = []
        continue
      }

      if (pending[pending.length - 1] === SPACE) {
        if (byte === Q) {
          const shape = cursorShape(String.fromCharCode(...pending.slice(2, -1)))
          if (shape) read(shape)
        }
        pending = byte === ESCAPE ? [ESCAPE] : []
        continue
      }

      if (byte === ESCAPE) {
        pending = [ESCAPE]
        continue
      }

      if (byte === SPACE || (byte >= 0x30 && byte <= 0x3f)) {
        pending.push(byte)
        if (pending.length > MAX_SEQUENCE) pending = []
        continue
      }

      pending = []
    }
  }
}

function cursorShape(parameters: string): CursorShape | undefined {
  const value = Number(parameters.split(";")[0] || 0)

  switch (value) {
    case 0:
    case 1:
      return { style: "block", blink: true }
    case 2:
      return { style: "block", blink: false }
    case 3:
      return { style: "underline", blink: true }
    case 4:
      return { style: "underline", blink: false }
    case 5:
      return { style: "bar", blink: true }
    case 6:
      return { style: "bar", blink: false }
  }
}
