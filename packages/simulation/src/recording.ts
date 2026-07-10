import { createWriteStream, type WriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { Writable } from "node:stream"
import { finished } from "node:stream/promises"
import { Schema } from "effect"

export const Header = Schema.Struct({
  type: Schema.Literal("header"),
  version: Schema.Literal(1),
  cols: Schema.Number,
  rows: Schema.Number,
  encoding: Schema.Literal("base64"),
})
export interface Header extends Schema.Schema.Type<typeof Header> {}

export const Output = Schema.Struct({
  type: Schema.Literal("output"),
  at_ms: Schema.Number,
  data: Schema.String,
})
export interface Output extends Schema.Schema.Type<typeof Output> {}

export const Resize = Schema.Struct({
  type: Schema.Literal("resize"),
  at_ms: Schema.Number,
  cols: Schema.Number,
  rows: Schema.Number,
})
export interface Resize extends Schema.Schema.Type<typeof Resize> {}

export const Event = Schema.Union([Header, Output, Resize])
export type Event = Schema.Schema.Type<typeof Event>

export class Timeline extends Writable {
  readonly isTTY = true
  readonly path: string
  readonly columns: number
  readonly rows: number
  private readonly output: WriteStream
  private readonly started = performance.now()
  private readonly timestamps: number[] = []
  private done?: Promise<string>

  private constructor(path: string, cols: number, rows: number, output: WriteStream) {
    super()
    this.path = path
    this.columns = cols
    this.rows = rows
    this.output = output
    // finish() reports stream failures; keep Writable from also throwing them process-wide.
    this.on("error", () => {})
    output.on("error", (error) => this.destroy(error))
  }

  static async create(path: string, cols: number, rows: number) {
    await mkdir(dirname(path), { recursive: true })
    const output = createWriteStream(path)
    const timeline = new Timeline(path, cols, rows, output)
    await new Promise<void>((resolve, reject) => {
      output.write(
        `${JSON.stringify({ type: "header", version: 1, cols, rows, encoding: "base64" } satisfies Header)}\n`,
        (error) => (error ? reject(error) : resolve()),
      )
    })
    return timeline
  }

  getColorDepth() {
    return 24
  }

  override write(chunk: unknown, callback?: (error?: Error | null) => void): boolean
  override write(chunk: unknown, encoding: BufferEncoding, callback?: (error?: Error | null) => void): boolean
  override write(
    chunk: unknown,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) {
    if (!this.writableEnded) {
      this.timestamps.push(this.elapsed())
      if (typeof encoding === "function") return super.write(chunk, encoding)
      if (encoding === undefined) return super.write(chunk, callback)
      return super.write(chunk, encoding, callback)
    }
    const done = typeof encoding === "function" ? encoding : callback
    queueMicrotask(() => done?.(null))
    return true
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.writeOutput(chunk, this.timestamps.shift() ?? this.elapsed(), callback)
  }

  override _final(callback: (error?: Error | null) => void) {
    this.writeOutput(Buffer.alloc(0), this.elapsed(), (error) => {
      if (error) return callback(error)
      this.output.end(callback)
    })
  }

  finish() {
    if (this.done) return this.done
    this.end()
    this.done = finished(this).then(() => this.path)
    return this.done
  }

  resize(cols: number, rows: number) {
    if (this.writableEnded) return
    const event = { type: "resize", at_ms: this.elapsed(), cols, rows } satisfies Resize
    this.output.write(`${JSON.stringify(event)}\n`)
  }

  private elapsed() {
    return Math.max(0, Math.round(performance.now() - this.started))
  }

  private writeOutput(data: Buffer, at_ms: number, callback: (error?: Error | null) => void) {
    const event = {
      type: "output",
      at_ms,
      data: data.toString("base64"),
    } satisfies Output
    this.output.write(`${JSON.stringify(event)}\n`, callback)
  }
}

export * as SimulationRecording from "./recording"
