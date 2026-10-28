import { describe, expect, test } from "bun:test"
import { withoutMedia } from "./slide-text"

type File = { readonly name: string; readonly text: string }

const files: readonly File[] = [
  { name: "[Content_Types].xml", text: "<Types/>" },
  { name: "ppt/media/image1.png", text: "png bytes" },
  { name: "ppt/presentation.xml", text: "<p:presentation/>" },
  { name: "ppt/media/image2.jpeg", text: "jpeg bytes" },
  { name: "ppt/slides/slide1.xml", text: "<p:sld>Hello</p:sld>" },
]

describe("withoutMedia", () => {
  test("drops the media entries and keeps every other entry readable", () => {
    const stripped = withoutMedia(zip(files))

    expect(read(stripped)).toEqual(
      files.flatMap((file) => (file.name.startsWith("ppt/media/") ? [] : [{ ...file, crc: crc(file.text) }])),
    )
  })

  test("reads a package that is a slice of a larger buffer", () => {
    const archive = zip(files)
    const padded = new Uint8Array(archive.length + 16)

    padded.set(archive, 7)

    expect(read(withoutMedia(padded.subarray(7, 7 + archive.length))).map((file) => file.name)).toEqual([
      "[Content_Types].xml",
      "ppt/presentation.xml",
      "ppt/slides/slide1.xml",
    ])
  })

  test("returns a package without media as it is", () => {
    const archive = zip(files.filter((file) => !file.name.startsWith("ppt/media/")))

    expect(withoutMedia(archive)).toBe(archive)
  })

  test("returns bytes that are not a zip package as they are", () => {
    const empty = new Uint8Array(0)
    const text = new TextEncoder().encode("not a zip archive, only some text that is long enough to search")

    expect(withoutMedia(empty)).toBe(empty)
    expect(withoutMedia(text)).toBe(text)
  })

  test("returns a ZIP64 package as it is", () => {
    const counted = zip(files)
    const offset = zip(files)
    const local = zip(files)

    end(counted).setUint16(10, 0xffff, true)
    end(offset).setUint32(16, 0xffffffff, true)
    record(local, 2).setUint32(42, 0xffffffff, true)

    expect(withoutMedia(counted)).toBe(counted)
    expect(withoutMedia(offset)).toBe(offset)
    expect(withoutMedia(local)).toBe(local)
  })

  test("returns a truncated package as it is", () => {
    const archive = zip(files)
    const cut = archive.subarray(0, archive.length - 30)

    expect(withoutMedia(cut)).toBe(cut)
  })

  test("returns a package with a malformed central directory as it is", () => {
    const missing = zip(files)
    const misplaced = zip(files)
    const longName = zip(files)
    const longExtra = zip(files)
    const pastDirectory = zip(files)
    const atDirectory = zip(files)

    // More records than the directory holds: the end record follows the last one.
    end(missing).setUint16(10, files.length + 1, true)
    end(misplaced).setUint32(16, 3, true)
    // The last record's name, then its extra field, run past the directory into the end record and beyond the file.
    record(longName, files.length - 1).setUint16(28, 0xffff, true)
    record(longExtra, files.length - 1).setUint16(30, 40, true)
    // A kept entry's local header at or past the directory.
    record(pastDirectory, 0).setUint32(42, end(pastDirectory).getUint32(16, true) + 100, true)
    record(atDirectory, 2).setUint32(42, end(atDirectory).getUint32(16, true), true)

    expect(withoutMedia(missing)).toBe(missing)
    expect(withoutMedia(misplaced)).toBe(misplaced)
    expect(withoutMedia(longName)).toBe(longName)
    expect(withoutMedia(longExtra)).toBe(longExtra)
    expect(withoutMedia(pastDirectory)).toBe(pastDirectory)
    expect(withoutMedia(atDirectory)).toBe(atDirectory)
  })
})

/** A stored (uncompressed) zip package of the files, without a comment. */
function zip(entries: readonly File[]) {
  const encoder = new TextEncoder()

  const parts = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    data: encoder.encode(entry.text),
    crc: crc(entry.text),
  }))

  const locals = parts.map((part) => {
    const local = new Uint8Array(30 + part.name.length + part.data.length)
    const view = new DataView(local.buffer)

    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint32(14, part.crc, true)
    view.setUint32(18, part.data.length, true)
    view.setUint32(22, part.data.length, true)
    view.setUint16(26, part.name.length, true)
    local.set(part.name, 30)
    local.set(part.data, 30 + part.name.length)

    return local
  })

  const starts = locals.map((_, index) => locals.slice(0, index).reduce((total, local) => total + local.length, 0))
  const directory = locals.reduce((total, local) => total + local.length, 0)

  const records = parts.map((part, index) => {
    const entry = new Uint8Array(46 + part.name.length)
    const view = new DataView(entry.buffer)

    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint32(16, part.crc, true)
    view.setUint32(20, part.data.length, true)
    view.setUint32(24, part.data.length, true)
    view.setUint16(28, part.name.length, true)
    view.setUint32(42, starts[index] ?? 0, true)
    entry.set(part.name, 46)

    return entry
  })

  const size = records.reduce((total, entry) => total + entry.length, 0)
  const tail = new Uint8Array(22)
  const view = new DataView(tail.buffer)

  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, parts.length, true)
  view.setUint16(10, parts.length, true)
  view.setUint32(12, size, true)
  view.setUint32(16, directory, true)

  const out = new Uint8Array(directory + size + 22)

  ;[...locals, ...records, tail].reduce((at, chunk) => {
    out.set(chunk, at)

    return at + chunk.length
  }, 0)

  return out
}

/** Reads every entry of a stored package through its central directory and local headers, as an unzipper does. */
function read(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const last = bytes.length - 22

  expect(view.getUint32(last, true)).toBe(0x06054b50)
  expect(view.getUint16(last + 8, true)).toBe(view.getUint16(last + 10, true))

  const count = view.getUint16(last + 10, true)
  const directory = view.getUint32(last + 16, true)

  expect(directory + view.getUint32(last + 12, true)).toBe(last)

  return Array.from({ length: count }).reduce<{ at: number; files: (File & { crc: number })[] }>(
    (state) => {
      expect(view.getUint32(state.at, true)).toBe(0x02014b50)

      const nameLength = view.getUint16(state.at + 28, true)
      const name = decoder.decode(bytes.subarray(state.at + 46, state.at + 46 + nameLength))
      const local = view.getUint32(state.at + 42, true)
      const size = view.getUint32(state.at + 20, true)

      expect(view.getUint32(local, true)).toBe(0x04034b50)
      expect(decoder.decode(bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)))).toBe(name)

      const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const text = decoder.decode(bytes.subarray(data, data + size))

      expect(crc(text)).toBe(view.getUint32(state.at + 16, true))
      state.files.push({ name, text, crc: view.getUint32(local + 14, true) })

      const length = 46 + nameLength + view.getUint16(state.at + 30, true) + view.getUint16(state.at + 32, true)

      return { at: state.at + length, files: state.files }
    },
    { at: directory, files: [] },
  ).files
}

function crc(text: string) {
  return Bun.hash.crc32(new TextEncoder().encode(text))
}

/** The end of central directory record of a package built by `zip`. */
function end(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22, 22)
}

/** The central directory record of a package built by `zip`, by index. */
function record(bytes: Uint8Array, index: number) {
  const directory = end(bytes).getUint32(16, true)
  const view = new DataView(bytes.buffer, bytes.byteOffset)

  const at = Array.from({ length: index }).reduce<number>(
    (current) => current + 46 + view.getUint16(current + 28, true),
    directory,
  )

  return new DataView(bytes.buffer, bytes.byteOffset + at)
}
