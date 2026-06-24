export type InputEvent =
  | { type: "KEY"; key: string }
  | { type: "CHAR"; char: string }
  | { type: "MOUSE"; button: number; x: number; y: number; release: boolean }
  | { type: "PASTE_START" }
  | { type: "PASTE_END" }
  | { type: "FOCUS_IN" }
  | { type: "FOCUS_OUT" }
  | { type: "RESIZE"; width: number; height: number }

type EventCallback = (event: InputEvent) => void

// ─── DFA constants ────────────────────────────────────────────

const C_CTRL     =  0
const C_ESC      =  1
const C_LBRACKET =  2
const C_SS3      =  3
const C_RBRACKET =  4
const C_SGR      =  5
const C_SEMI     =  6
const C_DIGIT    =  7
const C_FINAL    =  8
const C_BEL      =  9
const C_NL       = 10
const C_TAB      = 11
const C_SPACE    = 12
const C_PRINT    = 13
const C_COUNT    = 14

const S_IDLE      = 0
const S_ESC_SEEN  = 1
const S_CSI       = 2
const S_CSI_PARAM = 3
const S_SS3       = 4
const S_OSC       = 5
const S_OSC_ESC   = 6
const S_MOUSE_SGR = 7
const S_COUNT     = 8

const A_NONE        = 0
const A_EMIT_KEY    = 1
const A_EMIT_CHAR   = 2
const A_EMIT_CSI    = 3
const A_EMIT_ALT    = 4
const A_EMIT_MOUSE  = 5
const A_STORE_DIGIT = 6
const A_STORE_SEMI  = 7
const A_EMIT_ESC    = 8
const A_EMIT_SS3    = 9

const PACK = (a: number, s: number) => (a << 8) | s
const NEXT = (packed: number) => packed & 0xFF
const ACT  = (packed: number) => packed >>> 8

function buildTransitionTable(): Uint16Array {
  const t = new Uint16Array(S_COUNT * C_COUNT)

  const set = (s: number, c: number, next: number, act: number) => {
    t[s * C_COUNT + c] = PACK(act, next)
  }

  for (let s = 0; s < S_COUNT; s++)
    for (let c = 0; c < C_COUNT; c++)
      set(s, c, S_IDLE, A_NONE)

  // ─── IDLE ───────────────────────────────────────────────────
  set(S_IDLE, C_CTRL,     S_IDLE,      A_EMIT_KEY)
  set(S_IDLE, C_BEL,      S_IDLE,      A_EMIT_KEY)
  set(S_IDLE, C_ESC,      S_ESC_SEEN,  A_NONE)
  set(S_IDLE, C_LBRACKET, S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_SS3,      S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_RBRACKET, S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_SGR,      S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_SEMI,     S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_DIGIT,    S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_FINAL,    S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_NL,       S_IDLE,      A_EMIT_KEY)
  set(S_IDLE, C_TAB,      S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_SPACE,    S_IDLE,      A_EMIT_CHAR)
  set(S_IDLE, C_PRINT,    S_IDLE,      A_EMIT_CHAR)

  // ─── ESC_SEEN ───────────────────────────────────────────────
  set(S_ESC_SEEN, C_LBRACKET, S_CSI,       A_NONE)
  set(S_ESC_SEEN, C_SS3,      S_SS3,       A_NONE)
  set(S_ESC_SEEN, C_RBRACKET, S_OSC,       A_NONE)
  set(S_ESC_SEEN, C_ESC,      S_ESC_SEEN,  A_EMIT_ESC)
  set(S_ESC_SEEN, C_PRINT,    S_IDLE,      A_EMIT_ALT)
  set(S_ESC_SEEN, C_FINAL,    S_IDLE,      A_EMIT_ALT)
  set(S_ESC_SEEN, C_DIGIT,    S_IDLE,      A_EMIT_ALT)
  // everything else → S_IDLE, A_EMIT_ESC (bare ESC)
  for (let c = 0; c < C_COUNT; c++) {
    if (ACT(t[S_ESC_SEEN * C_COUNT + c]) === A_NONE && NEXT(t[S_ESC_SEEN * C_COUNT + c]) === S_IDLE) {
      set(S_ESC_SEEN, c, S_IDLE, A_EMIT_ESC)
    }
  }

  // ─── CSI ────────────────────────────────────────────────────
  set(S_CSI, C_DIGIT,   S_CSI_PARAM, A_STORE_DIGIT)
  set(S_CSI, C_SGR,     S_MOUSE_SGR, A_NONE)
  set(S_CSI, C_SEMI,    S_CSI_PARAM, A_STORE_SEMI)
  set(S_CSI, C_FINAL,   S_IDLE,      A_EMIT_CSI)
  set(S_CSI, C_SS3,     S_IDLE,      A_EMIT_CSI)
  // C_PRINT, etc → IDLE, A_NONE (default)

  // ─── CSI_PARAM ──────────────────────────────────────────────
  set(S_CSI_PARAM, C_DIGIT, S_CSI_PARAM, A_STORE_DIGIT)
  set(S_CSI_PARAM, C_SEMI,  S_CSI_PARAM, A_STORE_SEMI)
  set(S_CSI_PARAM, C_FINAL, S_IDLE,      A_EMIT_CSI)
  set(S_CSI_PARAM, C_SS3,   S_IDLE,      A_EMIT_CSI)

  // ─── SS3 ────────────────────────────────────────────────────
  set(S_SS3, C_FINAL, S_IDLE, A_EMIT_SS3)
  set(S_SS3, C_PRINT, S_IDLE, A_EMIT_SS3)
  set(S_SS3, C_SS3,   S_IDLE, A_EMIT_SS3)

  // ─── OSC ────────────────────────────────────────────────────
  set(S_OSC, C_ESC, S_OSC_ESC, A_NONE)
  set(S_OSC, C_BEL, S_IDLE,    A_NONE)

  // ─── OSC_ESC ────────────────────────────────────────────────
  // ST = ESC \ (0x1B 0x5C). 0x5C = C_PRINT → terminate OSC
  set(S_OSC_ESC, C_PRINT, S_IDLE, A_NONE)
  for (let c = 0; c < C_COUNT; c++) {
    if (ACT(t[S_OSC_ESC * C_COUNT + c]) === A_NONE && NEXT(t[S_OSC_ESC * C_COUNT + c]) === S_IDLE) {
      set(S_OSC_ESC, c, S_OSC, A_NONE)
    }
  }

  // ─── MOUSE_SGR ──────────────────────────────────────────────
  set(S_MOUSE_SGR, C_DIGIT, S_MOUSE_SGR, A_STORE_DIGIT)
  set(S_MOUSE_SGR, C_SEMI,  S_MOUSE_SGR, A_STORE_SEMI)
  set(S_MOUSE_SGR, C_FINAL, S_IDLE,      A_EMIT_MOUSE)

  return t
}

function buildClassLut(): Uint8Array {
  const lut = new Uint8Array(256)
  for (let b = 0; b < 256; b++) {
    if (b === 0x1B)                lut[b] = C_ESC
    else if (b === 0x5B)           lut[b] = C_LBRACKET
    else if (b === 0x4F)           lut[b] = C_SS3
    else if (b === 0x5D)           lut[b] = C_RBRACKET
    else if (b === 0x3C)           lut[b] = C_SGR
    else if (b === 0x3B)           lut[b] = C_SEMI
    else if (b >= 0x30 && b <= 0x39) lut[b] = C_DIGIT
    else if (b >= 0x40 && b <= 0x4E) lut[b] = C_FINAL
    else if (b >= 0x50 && b <= 0x5A) lut[b] = C_FINAL
    else if (b >= 0x5E && b <= 0x7E) lut[b] = C_FINAL
    else if (b === 0x07)           lut[b] = C_BEL
    else if (b === 0x0A || b === 0x0D) lut[b] = C_NL
    else if (b === 0x09)           lut[b] = C_TAB
    else if (b === 0x20)           lut[b] = C_SPACE
    else if (b >= 0x21 && b <= 0x2F) lut[b] = C_PRINT
    else if (b === 0x3A)           lut[b] = C_PRINT
    else if (b >= 0x3D && b <= 0x3F) lut[b] = C_PRINT
    else if (b === 0x5C)           lut[b] = C_PRINT
    else                           lut[b] = C_CTRL
  }
  return lut
}

const CSI_KEY: Record<number, string> = {
  0x41: "ArrowUp",
  0x42: "ArrowDown",
  0x43: "ArrowRight",
  0x44: "ArrowLeft",
  0x48: "Home",
  0x46: "End",
  0x49: "FOCUS_IN",
  0x4F: "FOCUS_OUT",
}

const CSI_TILDE: Record<number, string> = {
  1: "Home",
  2: "Insert",
  3: "Delete",
  4: "End",
  5: "PageUp",
  6: "PageDown",
  7: "Home",
  8: "End",
  200: "PASTE_START",
  201: "PASTE_END",
}

const SS3_KEY: Record<number, string> = {
  0x41: "ArrowUp",
  0x42: "ArrowDown",
  0x43: "ArrowRight",
  0x44: "ArrowLeft",
  0x48: "Home",
  0x46: "End",
  0x50: "F1",
  0x51: "F2",
  0x52: "F3",
  0x53: "F4",
}

export class InputHandler {
  private listeners: EventCallback[] = []
  private attached = false
  private input: NodeJS.ReadStream | { on: (ev: string, cb: (chunk: string) => void) => void; removeAllListeners: (ev: string) => void }

  private state = S_IDLE
  private paramIdx = 0
  private paramBuf = new Uint16Array(16)
  private pendingEsc = false
  private escTimer: ReturnType<typeof setTimeout> | null = null

  private pool: InputEvent[] = []
  private poolIdx = 0
  private poolSize = 64

  private static CLASS_LUT: Uint8Array
  private static TRANSITIONS: Uint16Array

  static {
    InputHandler.CLASS_LUT = buildClassLut()
    InputHandler.TRANSITIONS = buildTransitionTable()
  }

  constructor(input?: NodeJS.ReadStream | { on: (ev: string, cb: (chunk: string) => void) => void; removeAllListeners: (ev: string) => void }) {
    this.input = input ?? process.stdin
    this.buildPool()
  }

  private buildPool(): void {
    const p: InputEvent[] = new Array(this.poolSize)
    for (let i = 0; i < this.poolSize; i++)
      p[i] = { type: "", key: "", char: "", button: 0, x: 0, y: 0, release: false } as unknown as InputEvent
    this.pool = p
  }

  private acquire(): InputEvent {
    const evt = this.pool[this.poolIdx]
    this.poolIdx = (this.poolIdx + 1) & (this.poolSize - 1)
    const e = evt as any
    e.type = ""
    e.key = undefined
    e.char = undefined
    e.button = undefined
    e.x = undefined
    e.y = undefined
    e.release = undefined
    return evt
  }

  on(cb: EventCallback): () => void {
    if (cb.constructor.name === "AsyncFunction") {
      throw new TypeError("Async listener forbidden: pooled InputEvent lifecycle requires sync dispatch")
    }
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private emit(event: InputEvent): void {
    for (const cb of this.listeners) cb(event)
  }

  attach(): void {
    if (this.attached) return
    this.attached = true
    if ("setEncoding" in this.input) (this.input as any).setEncoding("utf8")
    this.input.on("data", (chunk: string) => this.feed(chunk))
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    this.input.removeAllListeners("data")
    this.clearEscTimer()
    this.pendingEsc = false
    this.state = S_IDLE
    this.paramIdx = 0
  }

  feed(data: unknown): void {
    let str: string
    if (typeof data === "string") str = data
    else if (Buffer.isBuffer(data)) str = data.toString("utf8")
    else str = String(data)

    const lut = InputHandler.CLASS_LUT
    const trans = InputHandler.TRANSITIONS

    // Check for pending ESC from a previous feed call
    if (this.pendingEsc && str.length > 0) {
      const firstByte = str.charCodeAt(0)
      const cls = lut[firstByte] | 0
      const packed = trans[S_ESC_SEEN * C_COUNT + cls]
      const next = NEXT(packed)
      if (next === S_CSI || next === S_SS3 || next === S_OSC) {
        this.clearEscTimer()
        this.pendingEsc = false
      } else {
        this.clearEscTimer()
        this.pendingEsc = false
        this.state = S_IDLE
        this.emitEscape()
      }
    }

    for (let i = 0; i < str.length; i++) {
      const byte = str.charCodeAt(i)
      const cls = lut[byte] | 0
      const packed = trans[this.state * C_COUNT + cls]
      const next = NEXT(packed)
      const act = ACT(packed)
      this.state = next

      switch (act) {
        case A_EMIT_CHAR: {
          this.dispatchChar(byte)
          break
        }
        case A_EMIT_KEY: {
          const evt = this.acquire()
          evt.type = "KEY"
          ;(evt as any).key = String.fromCodePoint(byte)
          this.emit(evt)
          break
        }
        case A_EMIT_CSI: {
          this.dispatchCSI(byte)
          break
        }
        case A_EMIT_ALT: {
          const evt = this.acquire()
          evt.type = "KEY"
          ;(evt as any).key = `Alt+${String.fromCodePoint(byte)}`
          this.emit(evt)
          break
        }
        case A_EMIT_MOUSE: {
          this.dispatchMouse(byte)
          break
        }
        case A_EMIT_SS3: {
          const key = SS3_KEY[byte] ?? String.fromCodePoint(byte)
          const evt = this.acquire()
          evt.type = "KEY"
          ;(evt as any).key = key
          this.emit(evt)
          break
        }
        case A_EMIT_ESC: {
          this.emitEscape()
          break
        }
        case A_STORE_DIGIT: {
          this.storeDigit(byte)
          break
        }
        case A_STORE_SEMI: {
          this.storeSemi()
          break
        }
      }
    }

    if (this.state === S_ESC_SEEN && !this.pendingEsc) {
      this.pendingEsc = true
      this.startEscTimer()
    } else if (this.state !== S_ESC_SEEN) {
      if (this.pendingEsc) {
        this.clearEscTimer()
        this.pendingEsc = false
      }
      this.paramIdx = 0
    }
  }

  private storeDigit(byte: number): void {
    if (this.paramIdx >= 16) return
    const cur = this.paramBuf[this.paramIdx] | 0
    this.paramBuf[this.paramIdx] = cur * 10 + (byte - 48)
  }

  private storeSemi(): void {
    this.paramIdx++
    if (this.paramIdx >= 16) this.paramIdx = 15
    this.paramBuf[this.paramIdx] = 0
  }

  private dispatchChar(byte: number): void {
    const ch = String.fromCodePoint(byte)
    const evt = this.acquire()
    evt.type = "CHAR"
    ;(evt as any).char = ch
    this.emit(evt)

    const evt2 = this.acquire()
    evt2.type = "KEY"
    ;(evt2 as any).key = ch
    this.emit(evt2)
  }

  private dispatchCSI(finalByte: number): void {
    const p0 = this.paramBuf[0] | 0

    if (p0 !== 0) {
      const key = CSI_TILDE[p0]
      if (key) {
        if (key === "PASTE_START") {
          const evt = this.acquire()
          evt.type = "PASTE_START"
          this.emit(evt)
          this.paramIdx = 0
          this.paramBuf[0] = 0
          return
        }
        if (key === "PASTE_END") {
          const evt = this.acquire()
          evt.type = "PASTE_END"
          this.emit(evt)
          this.paramIdx = 0
          this.paramBuf[0] = 0
          return
        }
        const evt = this.acquire()
        evt.type = "KEY"
        ;(evt as any).key = key
        this.emit(evt)
        this.paramIdx = 0
        this.paramBuf[0] = 0
        return
      }
    }

    const key = CSI_KEY[finalByte]
    if (key) {
      if (key === "FOCUS_IN") {
        const evt = this.acquire()
        evt.type = "FOCUS_IN"
        this.emit(evt)
        this.paramIdx = 0
        this.paramBuf[0] = 0
        return
      }
      if (key === "FOCUS_OUT") {
        const evt = this.acquire()
        evt.type = "FOCUS_OUT"
        this.emit(evt)
        this.paramIdx = 0
        this.paramBuf[0] = 0
        return
      }
      const evt = this.acquire()
      evt.type = "KEY"
      ;(evt as any).key = key
      this.emit(evt)
      this.paramIdx = 0
      this.paramBuf[0] = 0
      return
    }

    this.paramIdx = 0
    this.paramBuf[0] = 0
  }

  private dispatchMouse(finalByte: number): void {
    const btn = this.paramBuf[0] | 0
    const col = this.paramBuf[1] | 0
    const row = this.paramBuf[2] | 0

    const evt = this.acquire()
    evt.type = "MOUSE"
    ;(evt as any).button = btn
    ;(evt as any).x = col - 1
    ;(evt as any).y = row - 1
    ;(evt as any).release = finalByte === 0x6D
    this.emit(evt)

    this.paramIdx = 0
    this.paramBuf[0] = 0
  }

  private emitEscape(): void {
    const evt = this.acquire()
    evt.type = "KEY"
    ;(evt as any).key = "Escape"
    this.emit(evt)
  }

  private startEscTimer(): void {
    this.clearEscTimer()
    this.escTimer = setTimeout(() => {
      if (this.pendingEsc) {
        this.pendingEsc = false
        this.state = S_IDLE
        this.emitEscape()
      }
    }, 50)
  }

  private clearEscTimer(): void {
    if (this.escTimer !== null) {
      clearTimeout(this.escTimer)
      this.escTimer = null
    }
  }
}
