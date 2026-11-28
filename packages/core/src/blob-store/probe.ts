import { Effect } from "effect"

/** What a blob's bytes say about it, read from headers only. Display dimensions: rotation is already applied. */
export interface Facts {
  readonly width?: number
  readonly height?: number
  readonly durationMs?: number
}

export interface Source {
  readonly size: number
  readonly read: (offset: number, length: number) => Effect.Effect<Uint8Array, unknown>
}

/** Image and WebM headers sit at the start; a JPEG's EXIF can push its size past a few KB. */
const HEAD = 256 * 1024
/** An MP4's `moov` holds the sample tables too, so it grows with the length of the video. */
const MOVIE = 16 * 1024 * 1024

/** Reads the facts it knows for the type, and none for a type it doesn't know or bytes it can't parse. */
export const probe = (mime: string, source: Source): Effect.Effect<Facts> =>
  Effect.gen(function* () {
    if (mime === "video/mp4" || mime === "video/quicktime") return yield* mp4(source)
    if (!(mime.startsWith("image/") || mime === "video/webm")) return {}
    const head = yield* source.read(0, Math.min(source.size, HEAD))
    if (mime === "video/webm") return webm(head)
    return image(mime, head)
  }).pipe(Effect.catchCause(() => Effect.succeed({})))

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
const sized = (width: number, height: number): Facts => (width > 0 && height > 0 ? { width, height } : {})

function image(mime: string, bytes: Uint8Array): Facts {
  const data = view(bytes)
  if (mime === "image/png") return sized(data.getUint32(16), data.getUint32(20))
  if (mime === "image/gif") return sized(data.getUint16(6, true), data.getUint16(8, true))
  if (mime === "image/webp") return webp(bytes, data)
  if (mime === "image/jpeg") return jpeg(bytes, data)
  return {}
}

function webp(bytes: Uint8Array, data: DataView): Facts {
  const chunk = ascii(bytes, 12, 16)
  if (chunk === "VP8 ") return sized(data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff)
  if (chunk === "VP8L") {
    const bits = data.getUint32(21, true)
    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === "VP8X") return sized(uint(bytes, 24, 3, true) + 1, uint(bytes, 27, 3, true) + 1)
  return {}
}

/** Walks the markers to the frame header. EXIF orientations 5 to 8 turn the image a quarter, so they swap the sides. */
function jpeg(bytes: Uint8Array, data: DataView): Facts {
  let offset = 2
  let orientation = 1
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = bytes[offset + 1]!
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += marker === 0xff ? 1 : 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return {}
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = data.getUint16(offset + 5)
      const width = data.getUint16(offset + 7)
      return orientation >= 5 && orientation <= 8 ? sized(height, width) : sized(width, height)
    }
    if (marker === 0xe1 && ascii(bytes, offset + 4, offset + 8) === "Exif") orientation = exifOrientation(data, offset + 10)
    offset += 2 + data.getUint16(offset + 2)
  }
  return {}
}

function exifOrientation(data: DataView, tiff: number) {
  const little = data.getUint16(tiff) === 0x4949
  const ifd = tiff + data.getUint32(tiff + 4, little)
  const count = data.getUint16(ifd, little)
  const entry = Array.from({ length: count }, (_, index) => ifd + 2 + index * 12).find(
    (position) => data.getUint16(position, little) === 0x0112,
  )
  return entry === undefined ? 1 : data.getUint16(entry + 8, little)
}

/** Finds `moov` among the top-level boxes, wherever it is, and reads only that box. */
const mp4 = Effect.fnUntraced(function* (source: Source) {
  let offset = 0
  while (offset + 8 <= source.size) {
    const head = yield* source.read(offset, Math.min(16, source.size - offset))
    const data = view(head)
    const declared = data.getUint32(0)
    const size =
      declared === 1 ? Number(data.getBigUint64(8)) : declared === 0 ? source.size - offset : declared
    if (size < 8) return {}
    if (ascii(head, 4, 8) === "moov") {
      if (size > MOVIE) return {}
      return movie(yield* source.read(offset, Math.min(size, source.size - offset)))
    }
    offset += size
  }
  return {}
})

function movie(bytes: Uint8Array): Facts {
  const data = view(bytes)
  const top = boxes(data, 8, bytes.length)
  const header = top.find((box) => box.type === "mvhd")
  const durationMs = header === undefined ? undefined : movieDuration(data, header.start)
  const video = top
    .filter((box) => box.type === "trak")
    .map((trak) => boxes(data, trak.start, trak.end))
    .find((trak) => {
      const media = trak.find((box) => box.type === "mdia")
      const handler = media && boxes(data, media.start, media.end).find((box) => box.type === "hdlr")
      return handler !== undefined && ascii(bytes, handler.start + 8, handler.start + 12) === "vide"
    })
    ?.find((box) => box.type === "tkhd")
  return {
    ...(video === undefined ? {} : trackSize(data, video.start)),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

/** Child boxes of `[start, end)`, each as its payload's range. */
function boxes(data: DataView, start: number, end: number) {
  const found: { type: string; start: number; end: number }[] = []
  let offset = start
  while (offset + 8 <= end) {
    const size = data.getUint32(offset)
    if (size < 8) break
    found.push({
      type: ascii(new Uint8Array(data.buffer, data.byteOffset + offset + 4, 4), 0, 4),
      start: offset + 8,
      end: Math.min(offset + size, end),
    })
    offset += size
  }
  return found
}

function movieDuration(data: DataView, start: number) {
  const version = data.getUint8(start)
  const scale = data.getUint32(start + (version === 1 ? 20 : 12))
  const length = version === 1 ? Number(data.getBigUint64(start + 24)) : data.getUint32(start + 16)
  // A fragmented MP4 leaves it 0 and keeps the length in its fragments.
  return scale > 0 && length > 0 ? Math.round((length * 1000) / scale) : undefined
}

/** The track's presentation size; a matrix that turns it a quarter swaps the sides. */
function trackSize(data: DataView, start: number): Facts {
  const fields = start + (data.getUint8(start) === 1 ? 36 : 24) + 16
  const width = Math.round(data.getUint32(fields + 36) / 65536)
  const height = Math.round(data.getUint32(fields + 40) / 65536)
  const quarter = data.getInt32(fields) === 0 && data.getInt32(fields + 4) !== 0
  return quarter ? sized(height, width) : sized(width, height)
}

const SEGMENT = 0x18538067
const INFO = 0x1549a966
const TRACKS = 0x1654ae6b
const CLUSTER = 0x1f43b675

/** EBML: Segment > Info for the duration, Segment > Tracks for the first video track's size. */
function webm(bytes: Uint8Array): Facts {
  const segment = elements(bytes, 0, bytes.length).find((element) => element.id === SEGMENT)
  if (segment === undefined) return {}
  const top = elements(bytes, segment.start, segment.end, CLUSTER)
  const info = top.find((element) => element.id === INFO)
  const tracks = top.find((element) => element.id === TRACKS)
  const durationMs = info === undefined ? undefined : webmDuration(bytes, info)
  const video =
    tracks &&
    elements(bytes, tracks.start, tracks.end)
      .filter((element) => element.id === 0xae)
      .map((entry) => elements(bytes, entry.start, entry.end))
      .find((entry) => entry.some((element) => element.id === 0x83 && uint(bytes, element.start, element.length) === 1))
      ?.find((element) => element.id === 0xe0)
  const size = video === undefined ? [] : elements(bytes, video.start, video.end)
  const pixels = (id: number) => {
    const element = size.find((item) => item.id === id)
    return element === undefined ? 0 : uint(bytes, element.start, element.length)
  }
  return {
    ...sized(pixels(0xb0), pixels(0xba)),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

function webmDuration(bytes: Uint8Array, info: Element) {
  const children = elements(bytes, info.start, info.end)
  const scale = children.find((element) => element.id === 0x2ad7b1)
  const duration = children.find((element) => element.id === 0x4489)
  if (duration === undefined) return undefined
  const data = view(bytes)
  const ticks = duration.length === 4 ? data.getFloat32(duration.start) : data.getFloat64(duration.start)
  const nanoseconds = scale === undefined ? 1_000_000 : uint(bytes, scale.start, scale.length)
  return Math.round((ticks * nanoseconds) / 1_000_000)
}

interface Element {
  readonly id: number
  readonly start: number
  readonly end: number
  readonly length: number
}

/** Elements in `[start, end)`, stopping before `stop`. An unknown size, as in a live stream, runs to `end`. */
function elements(bytes: Uint8Array, start: number, end: number, stop?: number) {
  const found: Element[] = []
  let offset = start
  while (offset < end) {
    const id = vint(bytes, offset, true)
    if (id.value === stop) break
    const size = vint(bytes, offset + id.length, false)
    const payload = offset + id.length + size.length
    const length = size.value === 2 ** (7 * size.length) - 1 ? end - payload : size.value
    found.push({ id: id.value, start: payload, end: Math.min(payload + length, end), length })
    offset = payload + length
  }
  return found
}

function vint(bytes: Uint8Array, offset: number, marker: boolean) {
  const first = bytes[offset]!
  const length = Math.clz32(first) - 23
  if (length < 1 || length > 8) throw new Error("Invalid EBML variable-length integer")
  const value = Array.from({ length: length - 1 }, (_, index) => bytes[offset + 1 + index]!).reduce(
    (total, byte) => total * 256 + byte,
    marker ? first : first & (0xff >> length),
  )
  return { value, length }
}

function uint(bytes: Uint8Array, offset: number, length: number, little = false) {
  return Array.from({ length }, (_, index) => bytes[offset + (little ? length - 1 - index : index)]!).reduce(
    (total, byte) => total * 256 + byte,
    0,
  )
}
