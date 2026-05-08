import { createReadStream } from "fs"
import { PassThrough, Readable } from "stream"
import { Encoding } from "@/util/encoding"

/**
 * Encoding-aware text streaming for tools that walk a file line by line.
 * Optimistically stream as UTF-8; fall back to a buffered iconv decode only
 * when the bytes turn out not to be valid UTF-8.
 */

/** Distinct class so {@link withFallback} can tell us apart from real I/O failures. */
export class InvalidUtf8Error extends Error {
  constructor() {
    super("invalid utf-8")
  }
}

/**
 * UTF-8 text Readable for `filepath`. A leading UTF-8 BOM is stripped here by
 * `TextDecoder` (per WHATWG spec) — note this differs from
 * `createReadStream({ encoding: "utf8" })`, whose `StringDecoder` preserves
 * the BOM as U+FEFF. The {@link openDecoded} fallback also strips the BOM
 * (iconv's utf-8 codec drops it), so both paths agree on BOM handling.
 */
export function openUtf8(filepath: string): Readable {
  const out = new PassThrough({ encoding: "utf8" })
  const raw = createReadStream(filepath)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  raw.on("data", (chunk) => {
    try {
      const text = decoder.decode(chunk as Buffer, { stream: true })
      if (text) out.write(text)
    } catch {
      raw.destroy()
      out.destroy(new InvalidUtf8Error())
    }
  })
  raw.on("end", () => {
    try {
      const tail = decoder.decode()
      if (tail) out.write(tail)
      out.end()
    } catch {
      out.destroy(new InvalidUtf8Error())
    }
  })
  raw.on("error", (err) => out.destroy(err))
  // Propagate consumer-side teardown so early-exit (line / byte cap, fallback)
  // stops pulling chunks from disk instead of running to EOF.
  out.on("close", () => raw.destroy())
  return out
}

/** Whole-file UTF-8 Readable via {@link Encoding.read}; buffers the entire decoded file. */
export async function openDecoded(filepath: string): Promise<Readable> {
  const decoded = await Encoding.read(filepath)
  return Readable.from([decoded.text])
}

/**
 * Run `fn` against an optimistic UTF-8 stream; on {@link InvalidUtf8Error}
 * retry once against {@link openDecoded}. `fn` must be safe to retry — it is
 * called twice on the fallback path, so any side effects must be idempotent.
 * Other errors propagate.
 */
export async function withFallback<T>(filepath: string, fn: (input: Readable) => Promise<T>): Promise<T> {
  try {
    return await fn(openUtf8(filepath))
  } catch (err) {
    if (!(err instanceof InvalidUtf8Error)) throw err
  }
  return fn(await openDecoded(filepath))
}

export * as TextStream from "./text-stream"
