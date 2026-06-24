import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { InputHandler, type InputEvent } from "@/terminal/input/InputHandler"

const BENCH_TIMEOUT = 120000

// ─── Legacy baseline: fresh objects, if/else classifier, if/else transitions ─────────

function legacyClassify(byte: number): number {
  if (byte === 0x1B) return 1  // ESC
  if (byte === 0x5B) return 2  // LBRACKET
  if (byte >= 0x30 && byte <= 0x39) return 7  // DIGIT
  if (byte >= 0x40 && byte <= 0x5A || byte >= 0x5E && byte <= 0x7E) return 8  // FINAL
  if (byte === 0x0A || byte === 0x0D) return 10  // NL
  if (byte === 0x09) return 11  // TAB
  if (byte === 0x20) return 12  // SPACE
  if (byte >= 0x21 && byte <= 0x2F || byte === 0x3A || byte >= 0x3D && byte <= 0x3F || byte === 0x5C) return 13  // PRINT
  return 0  // CTRL
}

class LegacyInputHandler {
  private listeners: Array<(e: InputEvent) => void> = []
  private state = 0 // S_IDLE
  private paramIdx = 0
  private paramBuf = new Uint16Array(16)
  private pendingEsc = false
  private escTimer: ReturnType<typeof setTimeout> | null = null

  on(cb: (e: InputEvent) => void): void { this.listeners.push(cb) }

  private emit(type: InputEvent["type"], props: Record<string, any> = {}): void {
    const evt = { type, ...props } as InputEvent
    for (const cb of this.listeners) cb(evt)
  }

  feed(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const byte = data.charCodeAt(i)
      const cls = legacyClassify(byte)

      if (this.state === 0) { // IDLE
        if (cls === 1) { this.state = 1; continue } // ESC
        this.emit("KEY", { key: String.fromCodePoint(byte) })
        if (cls === 0 || cls === 8 || cls === 10 || cls === 13 ||
            cls === 7 || cls === 11 || cls === 12) {
          // Non-char -> just KEY
        } else {
          this.emit("CHAR", { char: String.fromCodePoint(byte) })
        }
      } else if (this.state === 1) { // ESC_SEEN
        if (cls === 2) { this.state = 2; continue } // LBRACKET -> CSI
        if (cls === 8 || cls === 13 || cls === 7) {
          this.state = 0
          this.emit("KEY", { key: `Alt+${String.fromCodePoint(byte)}` })
        } else if (cls === 1) {
          this.emit("KEY", { key: "Escape" })
          // stay in ESC_SEEN
        } else {
          this.state = 0
          this.emit("KEY", { key: "Escape" })
        }
      } else if (this.state === 2) { // CSI
        if (cls === 7) { // DIGIT
          this.state = 3
          this.storeDigit(byte)
        } else if (cls === 8) { // FINAL
          this.state = 0
          this.dispatchCSI(byte)
        } else {
          this.state = 0
        }
      } else if (this.state === 3) { // CSI_PARAM
        if (cls === 7) { this.storeDigit(byte) }
        else if (byte === 0x3B) { this.storeSemi() }
        else if (cls === 8) { this.state = 0; this.dispatchCSI(byte) }
        else { this.state = 0 }
      }
    }
  }

  feedBatch(data: string): void { this.feed(data) }

  private storeDigit(byte: number): void {
    if (this.paramIdx >= 16) return
    this.paramBuf[this.paramIdx] = this.paramBuf[this.paramIdx] * 10 + (byte - 48)
  }

  private storeSemi(): void {
    this.paramIdx++
    if (this.paramIdx >= 16) this.paramIdx = 15
    this.paramBuf[this.paramIdx] = 0
  }

  private dispatchCSI(finalByte: number): void {
    const p0 = this.paramBuf[0] | 0
    if (p0 !== 0) {
      const key: Record<number, string> = { 1: "Home", 2: "Insert", 3: "Delete", 4: "End", 5: "PageUp", 6: "PageDown" }
      if (key[p0]) { this.emit("KEY", { key: key[p0] }) }
    } else {
      const key: Record<number, string> = { 0x41: "ArrowUp", 0x42: "ArrowDown", 0x43: "ArrowRight", 0x44: "ArrowLeft" }
      if (key[finalByte]) { this.emit("KEY", { key: key[finalByte] }) }
    }
    this.paramIdx = 0
    this.paramBuf[0] = 0
  }
}

// ─── Test data generation ─────────────────────────────────────

const CHARS_SRC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /;,.<>!@#$%^&*()-_=+[]{}|`~"

function generateChars(count: number): string {
  let out = ""
  for (let i = 0; i < count; i++)
    out += CHARS_SRC[Math.floor(Math.random() * CHARS_SRC.length)]
  return out
}

function generateCSI(count: number): string {
  let out = ""
  const seqs = ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D", "\x1b[H", "\x1b[F", "\x1b[1~", "\x1b[2~", "\x1b[3~", "\x1b[4~", "\x1b[5~", "\x1b[6~"]
  for (let i = 0; i < count; i++)
    out += seqs[Math.floor(Math.random() * seqs.length)]
  return out
}

function generateMixed(count: number): string {
  let out = ""
  for (let i = 0; i < count; i++) {
    const r = Math.random()
    if (r < 0.70)
      out += CHARS_SRC[Math.floor(Math.random() * CHARS_SRC.length)]
    else if (r < 0.90)
      out += ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"][Math.floor(Math.random() * 4)]
    else
      out += ["\x1b[1~", "\x1b[3~", "\x1b[5~"][Math.floor(Math.random() * 3)]
  }
  return out
}

function generatePaste(sizeKB: number): string {
  const lines: string[] = []
  for (let i = 0; i < sizeKB * 2; i++) {
    let line = ""
    for (let j = 0; j < 50; j++)
      line += CHARS_SRC[Math.floor(Math.random() * CHARS_SRC.length)]
    lines.push(line)
  }
  return lines.join("\n")
}

// ─── Warmup: instantiate handlers once ────────────────────────

const CHARS_10K = generateChars(10000)
const CSI_1K = generateCSI(1000)
const MIXED_5K = generateMixed(5000)
const PASTE_200KB = generatePaste(200)

// ─── Benchmarks ───────────────────────────────────────────────

test("[InputHandler] chars/sec throughput (10K chars)", () => {
  // Baseline
  const baseHandler = new LegacyInputHandler()
  for (let i = 0; i < 3; i++) {
    const dummy: InputEvent[] = []
    baseHandler.on((e) => { dummy.push(e) })
    baseHandler.feedBatch(CHARS_10K)
  }

  // DFA
  const optHandler = new InputHandler()
  for (let i = 0; i < 3; i++) {
    const dummy: InputEvent[] = []
    optHandler.on((e) => { dummy.push(e) })
    optHandler.feed(CHARS_10K)
  }

  const result = runBenchmark({
    name: "input/chars-10K",
    baseline: () => {
      const h = new LegacyInputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feedBatch(CHARS_10K)
    },
    optimized: () => {
      const h = new InputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feed(CHARS_10K)
    },
    maxCV: 0.25,
    iterations: 30,
  })

  publishResult(result)
  writeResults()

  console.log(`[InputHandler] chars 10K: ratio ${result.baselineRatio.toFixed(3)} (DFA/legacy, lower=better)`)
  console.log(`[InputHandler] DFA mean: ${(result.mean / 1000).toFixed(1)}µs, legacy mean: ${(result.baselineMean / 1000).toFixed(1)}µs`)
  console.log(`[InputHandler] CV: ${(result.cv * 100).toFixed(2)}%`)

  expect(result.cv).toBeLessThan(0.25)
}, { timeout: BENCH_TIMEOUT })

test("[InputHandler] CSI/sec (1K CSI sequences)", () => {
  const result = runBenchmark({
    name: "input/csi-1K",
    baseline: () => {
      const h = new LegacyInputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feedBatch(CSI_1K)
    },
    optimized: () => {
      const h = new InputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feed(CSI_1K)
    },
    maxCV: 0.25,
    iterations: 30,
  })

  publishResult(result)
  writeResults()

  console.log(`[InputHandler] CSI 1K: ratio ${result.baselineRatio.toFixed(3)} (DFA/legacy, lower=better)`)
  console.log(`[InputHandler] DFA mean: ${(result.mean / 1000).toFixed(1)}µs, legacy mean: ${(result.baselineMean / 1000).toFixed(1)}µs`)

  expect(result.cv).toBeLessThan(0.25)
}, { timeout: BENCH_TIMEOUT })

test("[InputHandler] mixed load (5K events: 70% char, 20% CSI, 10% special)", () => {
  const result = runBenchmark({
    name: "input/mixed-5K",
    baseline: () => {
      const h = new LegacyInputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feedBatch(MIXED_5K)
    },
    optimized: () => {
      const h = new InputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feed(MIXED_5K)
    },
    maxCV: 0.20,
    iterations: 25,
  })

  publishResult(result)
  writeResults()

  console.log(`[InputHandler] mixed 5K: ratio ${result.baselineRatio.toFixed(3)} (DFA/legacy, lower=better)`)
  expect(result.cv).toBeLessThan(0.20)
}, { timeout: BENCH_TIMEOUT })

test("[InputHandler] paste throughput (200 KB)", () => {
  const result = runBenchmark({
    name: "input/paste-200KB",
    baseline: () => {
      const h = new LegacyInputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feedBatch(PASTE_200KB)
    },
    optimized: () => {
      const h = new InputHandler()
      const d: InputEvent[] = []
      h.on((e) => { d.push(e) })
      h.feed(PASTE_200KB)
    },
    maxCV: 0.15,
    iterations: 20,
  })

  publishResult(result)
  writeResults()

  console.log(`[InputHandler] paste 200KB: ratio ${result.baselineRatio.toFixed(3)} (DFA/legacy, lower=better)`)
  console.log(`[InputHandler] DFA mean: ${(result.mean / 1e6).toFixed(2)}ms, legacy mean: ${(result.baselineMean / 1e6).toFixed(2)}ms`)
  expect(result.cv).toBeLessThan(0.15)
}, { timeout: BENCH_TIMEOUT })
