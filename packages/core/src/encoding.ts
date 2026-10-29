/**
 * Shared file-encoding detection and round-tripping for the file tools.
 * Detection: BOM (UTF-8 / UTF-16LE / UTF-16BE), then UTF-8 validity, then a
 * statistical guess (jschardet) confirmed by a lossless decode/encode
 * round-trip. A confirmed encoding always reproduces the original bytes
 * exactly, so mutations write back byte-safe even when a CJK variant is
 * misidentified; bytes no encoding reproduces are reported as invalid so
 * mutation tools refuse them instead of corrupting them.
 */
export * as Encoding from "./encoding.js"

import { Effect, Schema } from "effect"
import { Bom } from "@opencode/util/bom"

export interface Source {
  readonly encoding: string
  readonly bom: boolean
  /**
   * False when the bytes are neither BOM-marked, valid UTF-8, nor losslessly
   * round-trippable in a detected encoding, meaning the decoded text is lossy
   * and mutation tools must refuse to write it back. detect() always sets it;
   * hand-built sources (e.g. defaults for a new file) may omit it.
   */
  readonly valid?: boolean
}

export const split = Bom.split
export const join = Bom.join

export class UnrepresentableError extends Schema.TaggedError<UnrepresentableError>()(
  "Encoding.UnrepresentableError",
  {
    encoding: Schema.String,
  },
) {
  override get message() {
    return `Content contains characters that cannot be written in ${this.encoding}`
  }
}

const BOM_PREFIXES = [
  { encoding: "utf-8", bytes: [0xef, 0xbb, 0xbf] },
  { encoding: "utf-16le", bytes: [0xff, 0xfe] },
  { encoding: "utf-16be", bytes: [0xfe, 0xff] },
] as const

// jschardet labels normalized to the encodings we round-trip and write with.
const LABELS: Record<string, string> = {
  gb18030: "gb18030",
  gbk: "gb18030",
  gb2312: "gb18030",
  big5: "big5",
  "big5-hkscs": "big5",
  shift_jis: "shift_jis",
  sjis: "shift_jis",
  cp932: "shift_jis",
  ms932: "shift_jis",
  "windows-31j": "shift_jis",
  "euc-kr": "euc-kr",
  cp949: "euc-kr",
  uhc: "euc-kr",
  "ks_c_5601-1987": "euc-kr",
  "euc-jp": "euc-jp",
}

// Single-byte encodings round-trip almost any byte stream, so only the
// statistical label separates them — and jschardet cannot reliably tell the
// Latin code pages apart at low confidence. Western text is mislabeled across
// that cluster, so those labels collapse onto windows-1252; a label naming a
// language-specific code page (Turkish windows-1254/iso-8859-9, Cyrillic,
// Greek, ...) means its letters are present, and refusing beats decoding them
// as wrong Latin letters. BOM-less UTF is never guessed here.
const SINGLE_BYTE_LABELS: Record<string, string> = {
  "windows-1250": "windows-1252",
  "windows-1252": "windows-1252",
  "iso-8859-1": "windows-1252",
  "iso-8859-2": "windows-1252",
  "iso-8859-3": "windows-1252",
  "iso-8859-15": "windows-1252",
  cp850: "windows-1252",
  cp852: "windows-1252",
}

// More decoded control characters (excluding tab/newline) than this share
// means the bytes are likely binary rather than legacy-encoded text. The C1
// range counts: real candidates map the high bytes to printable letters, so
// C1 only appears through lossy mappings of undefined byte positions.
const MAX_CONTROL_RATIO = 0.02

function startsWith(bytes: Uint8Array, prefix: readonly number[]) {
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
// sample, so a sampled prefix retries without up to 3 trailing bytes (the
// longest sequence) before giving up; a whole buffer must decode exactly, or
// a legacy file whose bytes merely look UTF-8-ish after dropping its tail
// would slip through and re-encode as replacement characters.
function validUtf8(bytes: Uint8Array, truncate: boolean) {
  for (let cut = 0; cut <= (truncate ? 3 : 0); cut++) {
    if (decodable(cut === 0 ? bytes : bytes.subarray(0, Math.max(0, bytes.length - cut)))) return true
  }
  return false
}

function plausible(text: string) {
  if (text.length === 0) return true
  let control = 0
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || (code >= 127 && code < 160)) control++
  }
  return control / text.length <= MAX_CONTROL_RATIO
}

type Legacy = [typeof import("iconv-lite"), typeof import("jschardet")]
let legacy: Promise<Legacy> | undefined
// WHATWG TextEncoder only emits UTF-8 and the runtime TextDecoder cannot be
// relied on for legacy encodings, so the heavy modules load only after BOM
// and UTF-8 checks fail.
const loadLegacy = () => (legacy ??= Promise.all([import("iconv-lite"), import("jschardet")] as const))

function normalize(label: string) {
  const value = label.toLowerCase()
  if (LABELS[value]) return LABELS[value]
  if (SINGLE_BYTE_LABELS[value]) return SINGLE_BYTE_LABELS[value]
  return undefined
}

function lossless(mod: Legacy[0], bytes: Uint8Array, encoding: string, truncate: boolean) {
  const buffer = Buffer.from(bytes)
  // A truncated multi-byte sequence at the end of a sampled prefix can decode
  // losslessly after dropping up to 3 trailing bytes; whole-file detection
  // must not, or a dangling lead byte would be written back as U+FFFD.
  for (let cut = 0; cut <= (truncate ? 3 : 0); cut++) {
    const sample = cut === 0 ? buffer : buffer.subarray(0, Math.max(0, bytes.length - cut))
    const text = mod.decode(sample, encoding)
    if (text.includes("\uFFFD")) continue
    if (!plausible(text)) return false
    if (Buffer.from(mod.encode(text, encoding)).equals(sample)) return true
  }
  return false
}

export const detect = (
  bytes: Uint8Array,
  options: { readonly sample?: boolean } = {},
): Effect.Effect<Source> =>
  Effect.promise(async () => {
    const truncate = options.sample === true
    for (const prefix of BOM_PREFIXES)
      if (startsWith(bytes, prefix.bytes)) return { encoding: prefix.encoding, bom: true, valid: true }
    if (validUtf8(bytes, truncate)) return { encoding: "utf-8", bom: false, valid: true }
    const [iconv, chardet] = await loadLegacy()
    // A lossless round-trip alone cannot separate gb18030 from big5,
    // shift_jis, or euc-kr because their byte ranges overlap, so the
    // statistical guess leads and the round-trip confirms it.
    const guess = normalize(chardet.detect(bytes)?.encoding ?? "")
    if (guess && lossless(iconv, bytes, guess, truncate)) return { encoding: guess, bom: false, valid: true }
    const confirmed = ["gb18030", "big5", "shift_jis", "euc-kr"].filter(
      (encoding) => encoding !== guess && lossless(iconv, bytes, encoding, truncate),
    )
    // More than one remaining candidate cannot be told apart reliably;
    // report the bytes as invalid rather than risk a mixed-encoding write.
    if (confirmed.length === 1) return { encoding: confirmed[0]!, bom: false, valid: true }
    return { encoding: "utf-8", bom: false, valid: false }
  })

export const decodeText = (bytes: Uint8Array, source: Source): Effect.Effect<string> => {
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    // Runtimes decode both utf-16 labels fine; the TS label union only lists "utf-16".
    return Effect.succeed(new TextDecoder(source.encoding as "utf-16").decode(bytes))
  if (source.encoding === "utf-8") return Effect.succeed(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
  return Effect.promise(() => loadLegacy().then(([iconv]) => iconv.decode(Buffer.from(bytes), source.encoding)))
}

/**
 * A synchronous page decoder for a detected source. Reads page raw byte
 * ranges whose boundaries always sit after a newline byte, so each range is
 * independently decodable. UTF-8 and UTF-16 strip a leading BOM like the
 * runtime decoder.
 */
export const pageDecoder = (source: Source): Effect.Effect<(bytes: Uint8Array) => string> => {
  if (source.encoding === "utf-8") return Effect.succeed((bytes) => new TextDecoder("utf-8").decode(bytes))
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    return Effect.succeed((bytes) => new TextDecoder(source.encoding as "utf-16").decode(bytes))
  return Effect.promise(
    () => loadLegacy().then(([iconv]) => (bytes: Uint8Array) => iconv.decode(Buffer.from(bytes), source.encoding)),
  )
}

export const encodeText = (text: string, source: Source): Effect.Effect<Uint8Array, UnrepresentableError> => {
  const stripped = split(text).text
  return Effect.flatMap(encodeBytes(stripped, source), (bytes) =>
    // iconv-lite silently turns characters the target encoding cannot hold
    // into "?", and TextEncoder replaces lone surrogates with U+FFFD; verify
    // the decode instead of corrupting the file.
    Effect.flatMap(decodeText(bytes, source), (decoded) =>
      split(decoded).text === stripped ? Effect.succeed(bytes) : new UnrepresentableError({ encoding: source.encoding }),
    ),
  )
}

const encodeBytes = (text: string, source: Source): Effect.Effect<Uint8Array> => {
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    return Effect.succeed(encodeUtf16(text, source.encoding))
  if (source.encoding === "utf-8") return Effect.succeed(encodeUtf8(text, source.bom))
  return Effect.promise(() => loadLegacy().then(([iconv]) => iconv.encode(text, source.encoding)))
}

function encodeUtf8(text: string, bom: boolean) {
  const bytes = new TextEncoder().encode(text)
  if (!bom) return bytes
  const withBom = new Uint8Array(bytes.length + 3)
  withBom.set([0xef, 0xbb, 0xbf])
  withBom.set(bytes, 3)
  return withBom
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
