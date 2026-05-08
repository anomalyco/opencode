import { readFile, writeFile, mkdir } from "fs/promises"
import { readFileSync } from "fs"
import { dirname } from "path"
import chardet from "chardet"
import iconv from "iconv-lite"

/**
 * Text encoding detection and preservation for tool file I/O.
 *
 * Supported:
 *  - UTF-8 (with or without BOM)
 *  - UTF-16 LE/BE with BOM (detected by chardet)
 *  - UTF-32 LE/BE with BOM (detected by chardet)
 *  - Legacy Latin and CJK encodings (detected by chardet)
 *
 * Not supported:
 *  - UTF-16 or UTF-32 without BOM (ambiguous, rare)
 *
 * Detection strategy:
 *  1. If the bytes are valid UTF-8, treat as UTF-8 (tracking the presence of a
 *     BOM so it can be written back).
 *  2. Otherwise, trust chardet. chardet only reports the wide UTF variants
 *     when a BOM is present, which aligns with the contract above.
 *
 * iconv-lite's UTF codecs strip BOMs on decode and do not emit them on encode,
 * so UTF BOMs are handled explicitly in {@link encode} to round-trip cleanly.
 */

export const DEFAULT = "utf-8"
/**
 * Synthetic label for UTF-8 files that start with a BOM. iconv-lite's utf-8
 * codec always strips BOMs on decode and never emits one on encode, so we
 * track the "with BOM" case explicitly to round-trip it faithfully.
 */
export const UTF8_BOM = "utf-8-bom"
const BOMS = {
  "utf-8-bom": Buffer.from([0xef, 0xbb, 0xbf]),
  "utf-16le": Buffer.from([0xff, 0xfe]),
  "utf-16be": Buffer.from([0xfe, 0xff]),
  "utf-32le": Buffer.from([0xff, 0xfe, 0x00, 0x00]),
  "utf-32be": Buffer.from([0x00, 0x00, 0xfe, 0xff]),
}

function startsWith(bytes: Buffer, bom: Buffer, limit: number): boolean {
  return limit >= bom.length && bytes.subarray(0, bom.length).equals(bom)
}

function hasUtf8Bom(bytes: Buffer): boolean {
  return startsWith(bytes, BOMS["utf-8-bom"], bytes.length)
}

/** True if `bytes[0..limit]` starts with a UTF-16 LE or BE byte-order mark. */
export function hasUtf16Bom(bytes: Buffer, limit = bytes.length): boolean {
  // UTF-32 LE starts with FF FE 00 00, so exclude it to avoid misclassifying as UTF-16 LE.
  if (hasUtf32Bom(bytes, limit)) return false
  return startsWith(bytes, BOMS["utf-16le"], limit) || startsWith(bytes, BOMS["utf-16be"], limit)
}

/** True if `bytes[0..limit]` starts with a UTF-32 LE or BE byte-order mark. */
export function hasUtf32Bom(bytes: Buffer, limit = bytes.length): boolean {
  return startsWith(bytes, BOMS["utf-32le"], limit) || startsWith(bytes, BOMS["utf-32be"], limit)
}

/**
 * Canonicalize chardet labels to a stable lowercase-hyphenated form.
 *
 * iconv-lite already accepts every label chardet emits (e.g. "UTF-16 LE",
 * "Shift_JIS", "KOI8-R"), so this map is not required to make decode/encode
 * work. Its job is to give the rest of the codebase a consistent label —
 * callers compare against `"utf-16le"`, `"windows-1251"`, etc., and should
 * not have to account for chardet's casing or whitespace conventions.
 *
 * ISO-2022-* is unsupported by iconv-lite under any alias and is left out
 * of the map; those labels fall through the `encodingExists` guard in
 * `detect()` and are rejected to UTF-8.
 */
function normalize(name: string): string {
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, "")
  const map: Record<string, string> = {
    utf8: "utf-8",
    utf16le: "utf-16le",
    utf16be: "utf-16be",
    utf32le: "utf-32le",
    utf32be: "utf-32be",
    iso88591: "iso-8859-1",
    iso88592: "iso-8859-2",
    iso88595: "iso-8859-5",
    iso88597: "iso-8859-7",
    iso88598: "iso-8859-8",
    iso88599: "iso-8859-9",
    windows1250: "windows-1250",
    windows1251: "windows-1251",
    windows1252: "windows-1252",
    windows1253: "windows-1253",
    windows1255: "windows-1255",
    shiftjis: "Shift_JIS",
    eucjp: "euc-jp",
    euckr: "euc-kr",
    big5: "big5",
    gb18030: "gb18030",
    koi8r: "koi8-r",
  }
  return map[lower] ?? name
}

function isUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export function detect(bytes: Buffer): string {
  if (bytes.length === 0) return DEFAULT
  if (isUtf8(bytes)) return hasUtf8Bom(bytes) ? UTF8_BOM : DEFAULT
  const result = chardet.detect(bytes)
  if (!result) return DEFAULT
  const enc = normalize(result)
  if (!iconv.encodingExists(enc)) return DEFAULT
  return enc
}

export function decode(bytes: Buffer, encoding: string): string {
  if (encoding === UTF8_BOM) return iconv.decode(bytes, "utf-8")
  return iconv.decode(bytes, encoding)
}

export function encode(text: string, encoding: string): Buffer {
  // iconv-lite's UTF codecs strip/ignore BOMs, but we support "UTF-X with BOM"
  // as a distinct variant. Prepend the BOM manually so round-tripping keeps
  // the original byte signature intact. Strip a leading U+FEFF from `text`
  // first so we never emit a double BOM when the decoded text already
  // contains one (e.g. if a tool round-trips content verbatim).
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const key = encoding === UTF8_BOM ? UTF8_BOM : encoding.toLowerCase()
  const bom = BOMS[key as keyof typeof BOMS]
  if (bom) return Buffer.concat([bom, iconv.encode(body, key === UTF8_BOM ? "utf-8" : key)])
  return iconv.encode(text, encoding)
}

/** Read a file, detecting its encoding. */
export async function read(path: string): Promise<{ text: string; encoding: string }> {
  const bytes = await readFile(path)
  const encoding = detect(bytes)
  return { text: decode(bytes, encoding), encoding }
}

/** Synchronous read, detecting encoding. */
export function readSync(path: string): { text: string; encoding: string } {
  const bytes = readFileSync(path)
  const encoding = detect(bytes)
  return { text: decode(bytes, encoding), encoding }
}

/** Write text, ensuring parent directory exists, using the given encoding. */
export async function write(path: string, text: string, encoding: string = DEFAULT): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, encode(text, encoding))
}

export * as Encoding from "./encoding"
