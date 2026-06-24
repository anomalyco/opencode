import { Adapter } from "../core/Adapter"
import { DoubleBuffer } from "../buffer/DoubleBuffer"
import { OutputChannel } from "../buffer/OutputChannel"
import { GlobalBus } from "@/bus/global"
import type { GlobalEvent } from "@/bus/global"

const TERM_SIZE_THRESHOLD = 80
const DEFAULT_WIDTH = 80
const DEFAULT_HEIGHT = 24

export interface ScreenSummary {
  lines: string[]
  timestamp: number
}

export class NeuralLink {
  private adapter: Adapter
  private doubleBuffer: DoubleBuffer
  private output: OutputChannel
  private summaries: ScreenSummary[] = []
  private summaryMaxLen = 10
  private listening = false

  constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, output?: OutputChannel) {
    this.doubleBuffer = new DoubleBuffer(width, height)
    this.output = output ?? new OutputChannel()
    this.adapter = new Adapter(this.doubleBuffer, this.output)
  }

  // ─── Forward path: LLM → Terminal ───────────────────────────

  writeAI(bytes: Uint8Array): boolean {
    const text = new TextDecoder().decode(bytes)
    const result = this.adapter.writeAI(bytes)
    this.captureSummary(text)
    return result
  }

  writeAIText(text: string): boolean {
    return this.writeAI(new TextEncoder().encode(text))
  }

  // ─── Backward path: Terminal → AI Context ──────────────────

  private captureSummary(text: string): void {
    const lines = text.split("\n")
    const dirtyLines: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].slice(0, TERM_SIZE_THRESHOLD).trim()
      if (trimmed.length > 0)
        dirtyLines.push(`L${i + 1}: ${trimmed}`)
    }

    this.summaries.push({ lines: dirtyLines, timestamp: Date.now() })
    if (this.summaries.length > this.summaryMaxLen)
      this.summaries.shift()
  }

  getScreenSummary(): string {
    if (this.summaries.length === 0) return "[Screen: no output yet]"
    const latest = this.summaries[this.summaries.length - 1]
    if (latest.lines.length === 0) return "[Screen: no recent changes]"
    return `[Screen at ${new Date(latest.timestamp).toLocaleTimeString()}]:\n${latest.lines.join("\n")}`
  }

  getRecentSummaries(maxCount = 3): ScreenSummary[] {
    return this.summaries.slice(-maxCount)
  }

  // ─── GlobalBus subscription ─────────────────────────────────

  startListening(): void {
    if (this.listening) return
    this.listening = true
    GlobalBus.on("event", this.handleGlobalEvent)
  }

  stopListening(): void {
    if (!this.listening) return
    this.listening = false
    GlobalBus.off("event", this.handleGlobalEvent)
  }

  private handleGlobalEvent = (event: GlobalEvent): void => {
    const p = event.payload
    if (!p || typeof p !== "object") return
    if (p.type === "session.next.text.ended" && typeof p.properties?.text === "string") {
      const bytes = new TextEncoder().encode(p.properties.text)
      this.writeAI(bytes)
    }
  }

  resize(width: number, height: number): void {
    this.doubleBuffer.resize(width, height)
  }

  getAdapter(): Adapter {
    return this.adapter
  }
}
