import { describe, expect, it, test } from "bun:test"
import { Mime } from "@opencode/core/mime"

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (value: string) => Uint8Array.from([...value].map((char) => char.charCodeAt(0)))
const ftyp = (brand: string) => Uint8Array.from([0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii(brand)])
const isoBmff = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"))

describe("Mime.detect", () => {
  test.each([
    [Uint8Array.of(65), "text/plain"],
    [Uint8Array.of(0xff), "application/octet-stream"],
    [Uint8Array.of(0xe2, 0x82), "text/plain"], // A sample may end inside a UTF-8 character.
  ] as const)("leaves samples without media headers to the text fallback: %j", (bytes, mime) => {
    expect(Mime.detectMedia(bytes)).toBeUndefined()
    expect(Mime.detect(bytes)).toBe(mime)
  })

  test("never invents a media type from the path", () => {
    // Unknown binary keeps the caller's binary handling: `read` raises BinaryFileError rather than sending a corrupt
    // or mislabelled file to the provider typed as media.
    const binary = Uint8Array.of(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07)
    expect(Mime.detect(binary)).toBe("application/octet-stream")
    expect(Mime.detect(binary, "garbage.mp4")).toBe("application/octet-stream")
    expect(Mime.detect(binary, "garbage.gif")).toBe("application/octet-stream")
  })

  test("keeps text ahead of the path's extension", () => {
    // A media extension must not turn text into media: `read` would attach it as base64 in history, where it fails
    // on every later turn. A Git-LFS pointer is the common case.
    expect(Mime.detect(ascii("hello world"), "notes.gif")).toBe("text/plain")
    expect(Mime.detect(ascii("version https://git-lfs.github.com/spec/v1\n"), "clip.mp4")).toBe("text/plain")
  })

  test("keeps ordinary text starting with BM as text", () => {
    for (const text of ["BM", "BMW service schedule\n"]) expect(Mime.detect(Buffer.from(text))).toBe("text/plain")
  })

  test("detects Windows and OS/2 bitmaps from a prefix", () => {
    // 1x1, 24-bit bitmaps with a four-byte padded pixel row.
    const windows = "424d3a000000000000003600000028000000010000000100000001001800" + "00".repeat(28)
    const os2 = "424d1e000000000000001a0000000c000000010001000100180000000000"
    for (const hex of [windows, os2]) {
      const bytes = Buffer.from(hex, "hex")
      expect(Mime.detect(bytes)).toBe("image/bmp")
      expect(Mime.detect(bytes.subarray(0, 18))).toBe("image/bmp")
    }
  })

  test("tells ISO-BMFF brands apart", () => {
    expect(Mime.detect(isoBmff("000000206674797061766966000000004d695072617669666d6961666d696631"))).toBe("image/avif")
    expect(Mime.detect(isoBmff("000000186674797061766973000000006d73663161766973"))).toBe("image/avif")
    expect(Mime.detect(isoBmff("00000018667479706d69663100000000617669666d69663100000000"))).toBe("image/avif")
    expect(Mime.detect(isoBmff("000000246674797068656963000000006d6966314d6950726d6961664d694842"))).toBe("image/heic")
    expect(Mime.detect(isoBmff("00000018667479706d69663100000000686569636d69663100000000"))).toBe("image/heic")
    expect(Mime.detect(isoBmff("000000206674797069736f6d0000020069736f6d69736f32617663316d703431"))).toBe("video/mp4")
    expect(Mime.detect(isoBmff("00000014667479707174202000000200717420200000000877696465"))).toBe("video/quicktime")
    expect(Mime.detect(isoBmff("0000001c667479704d344120000002004d34412069736f6d69736f3200000008"))).toBe("audio/mp4")
  })

  const cases: Array<[string, Uint8Array, ReturnType<typeof Mime.detect>]> = [
    ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    ["gif", bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "image/gif"],
    ["bmp", bytes(0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00), "image/bmp"],
    ["pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "application/pdf"],
    ["webp", Uint8Array.from([...ascii("RIFF"), 0x00, 0x00, 0x00, 0x00, ...ascii("WEBP")]), "image/webp"],
    ["avif", ftyp("avif"), "image/avif"],
    ["mp3 with ID3 tag", bytes(0x49, 0x44, 0x33, 0x03, 0x00), "audio/mpeg"],
    ["mp3 frame sync", bytes(0xff, 0xfb, 0x90, 0x00), "audio/mpeg"],
    ["wav", Uint8Array.from([...ascii("RIFF"), 0x00, 0x00, 0x00, 0x00, ...ascii("WAVE")]), "audio/wav"],
    ["ogg", bytes(0x4f, 0x67, 0x67, 0x53, 0x00), "audio/ogg"],
    ["flac", bytes(0x66, 0x4c, 0x61, 0x43, 0x00), "audio/flac"],
    ["m4a", ftyp("M4A "), "audio/mp4"],
    ["mp4", ftyp("isom"), "video/mp4"],
    ["mov", ftyp("qt  "), "video/quicktime"],
    ["webm", bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01), "video/webm"],
    ["avi", Uint8Array.from([...ascii("RIFF"), 0x00, 0x00, 0x00, 0x00, ...ascii("AVI ")]), "video/x-msvideo"],
    ["plain text", ascii("hello world"), "text/plain"],
    ["binary", bytes(0x00, 0x01, 0x02, 0x03), "application/octet-stream"],
  ]

  cases.forEach(([name, input, expected]) => {
    it(`detects ${name}`, () => {
      expect(Mime.detect(input)).toBe(expected)
    })
  })
})

describe("Mime.detect with a path", () => {
  it("does not treat a UTF-16LE text file as audio", () => {
    const utf16le = bytes(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00)
    expect(Mime.detect(utf16le)).toBe("application/octet-stream")
    // The extension never decides on its own, so a `.txt` name does not make these bytes text; `read` raises
    // BinaryFileError for them.
    expect(Mime.detect(utf16le, "note.txt")).toBe("application/octet-stream")
  })

  it("uses the extension to disambiguate an audio-only MP4 container", () => {
    expect(Mime.detect(ftyp("isom"), "clip.m4a")).toBe("audio/mp4")
    expect(Mime.detect(ftyp("mp42"), "clip.m4a")).toBe("audio/mp4")
    expect(Mime.detect(ftyp("isom"), "sound.aac")).toBe("audio/aac")
    expect(Mime.detect(ftyp("isom"), "clip.mp4")).toBe("video/mp4")
  })
})
