import type { CookieRead, ImportedCookie } from "./cookie"

/** Seconds between 1970-01-01 and 2001-01-01, the epoch of Safari's timestamps. */
const MAC_EPOCH_OFFSET = 978_307_200

/**
 * Parses Safari's `Cookies.binarycookies`: big-endian page sizes, then pages of little-endian cookie records with
 * null-terminated strings. Undefined for a file that is not one, or whose page table does not fit it. Every count and
 * offset is checked against the bytes there are, so a damaged or hostile file costs no more than its size: a page that
 * does not fit counts as one failed record, and so does a record that does not fit its page.
 */
export function parseBinaryCookies(data: Uint8Array): CookieRead | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (data.byteLength < 8 || new TextDecoder().decode(data.subarray(0, 4)) !== "cook") return undefined
  const count = view.getUint32(4)

  if (8 + count * 4 > data.byteLength) return undefined
  const cookies: ImportedCookie[] = []
  const cursor = { start: 8 + count * 4, failed: 0 }

  Array.from({ length: count }, (_, index) => view.getUint32(8 + index * 4)).forEach((size) => {
    const start = cursor.start
    cursor.start += size
    const length = Math.min(size, data.byteLength - start)
    const page = length >= 8 ? new DataView(data.buffer, data.byteOffset + start, length) : undefined
    const records = page ? page.getUint32(4, true) : 0

    if (!page || 8 + records * 4 > page.byteLength) return void cursor.failed++

    Array.from({ length: records }, (_, item) => page.getUint32(8 + item * 4, true)).forEach((offset) => {
      const cookie = readCookie(page, offset)

      if (cookie) return void cookies.push(cookie)
      cursor.failed++
    })
  })

  return { cookies, protected: 0, failed: cursor.failed }
}

function readCookie(page: DataView, offset: number): ImportedCookie | undefined {
  if (offset + 56 > page.byteLength) return undefined
  const size = page.getUint32(offset, true)

  if (offset + size > page.byteLength) return undefined
  const flags = page.getUint32(offset + 8, true)
  const text = (field: number) => cString(page, offset + page.getUint32(offset + field, true), offset + size)
  const host = text(16)
  const name = text(20)
  const path = text(24)
  const value = text(28)

  if (host === undefined || name === undefined || path === undefined || value === undefined) return undefined
  const expiry = page.getFloat64(offset + 40, true)

  return {
    host,
    name,
    value,
    path,
    secure: (flags & 1) !== 0,
    httpOnly: (flags & 4) !== 0,
    expires: expiry > 0 ? expiry + MAC_EPOCH_OFFSET : undefined,
    sameSite: "unspecified",
  }
}

function cString(page: DataView, start: number, end: number) {
  const bytes = new Uint8Array(page.buffer, page.byteOffset, page.byteLength)
  const stop = bytes.indexOf(0, start)

  if (start >= end || stop < 0 || stop > end) return undefined

  return new TextDecoder().decode(bytes.subarray(start, stop))
}
