import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

const BOM_CODE = 0xfeff
const BOM = String.fromCharCode(BOM_CODE)

export interface Source {
  encoding: string
  bom: boolean
}

export function split(text: string) {
  if (text.charCodeAt(0) !== BOM_CODE) return { bom: false, text }
  return { bom: true, text: text.slice(1) }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  if (!bom) return stripped
  return BOM + stripped
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function decodable(bytes: Uint8Array) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// A valid multi byte UTF-8 sequence can be cut at the end of a truncated
// sample, so retry without up to 3 trailing bytes before giving up.
function validUtf8(bytes: Uint8Array) {
  if (decodable(bytes)) return true
  return decodable(bytes.slice(0, Math.max(0, bytes.length - 3)))
}

export function detect(bytes: Uint8Array, fallback = "utf-8"): Source {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { encoding: "utf-8", bom: true }
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: "utf-16le", bom: true }
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: "utf-16be", bom: true }
  if (validUtf8(bytes)) return { encoding: "utf-8", bom: false }
  return { encoding: fallback, bom: false }
}

function encodeUtf16(text: string, encoding: "utf-16le" | "utf-16be") {
  const little = encoding === "utf-16le"
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = little ? 0xff : 0xfe
  bytes[1] = little ? 0xfe : 0xff
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const offset = 2 + i * 2
    if (little) {
      bytes[offset] = code & 0xff
      bytes[offset + 1] = code >>> 8
    } else {
      bytes[offset] = code >>> 8
      bytes[offset + 1] = code & 0xff
    }
  }
  return bytes
}

export const readFile = Effect.fn("Encoding.readFile")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  fallback = "utf-8",
) {
  const bytes = yield* fs.readFile(filePath)
  const detected = detect(bytes, fallback)
  if (detected.encoding === "utf-8") {
    const next = split(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
    return { encoding: "utf-8", bom: next.bom, text: next.text }
  }
  if (detected.encoding === "utf-16le" || detected.encoding === "utf-16be") {
    return { encoding: detected.encoding, bom: true, text: new TextDecoder(detected.encoding).decode(bytes) }
  }
  const iconv = yield* Effect.promise(() => import("iconv-lite"))
  return { encoding: detected.encoding, bom: false, text: iconv.decode(Buffer.from(bytes), detected.encoding) }
})

export const writeFile = Effect.fn("Encoding.writeFile")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  text: string,
  source: Source,
) {
  if (source.encoding === "utf-8") {
    return yield* fs.writeWithDirs(filePath, join(text, source.bom))
  }
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be") {
    return yield* fs.writeWithDirs(filePath, encodeUtf16(text, source.encoding))
  }
  const iconv = yield* Effect.promise(() => import("iconv-lite"))
  return yield* fs.writeWithDirs(filePath, iconv.encode(text, source.encoding))
})

// Formatters rewrite files as UTF-8 without BOM, so after formatting the file
// is decoded as-is and rewritten with the encoding it was loaded with.
export const syncFile = Effect.fn("Encoding.syncFile")(function* (fs: FSUtil.Interface, filePath: string, source: Source) {
  const current = yield* readFile(fs, filePath, source.encoding)
  if (current.encoding === source.encoding && current.bom === source.bom) return current.text
  yield* writeFile(fs, filePath, current.text, source)
  return current.text
})

export * as Encoding from "./encoding"
