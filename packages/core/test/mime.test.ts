import { describe, expect, it } from "bun:test"
import { Mime } from "@opencode/core/mime"

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (value: string) => Uint8Array.from([...value].map((char) => char.charCodeAt(0)))
const ftyp = (brand: string) => Uint8Array.from([0x00, 0x00, 0x00, 0x18, ...ascii("ftyp"), ...ascii(brand)])

describe("Mime.detect", () => {
  const cases: Array<[string, Uint8Array, ReturnType<typeof Mime.detect>]> = [
    ["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    ["jpeg", bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    ["gif", bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "image/gif"],
    ["bmp", bytes(0x42, 0x4d, 0x00, 0x00), "image/bmp"],
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
    expect(Mime.detect(utf16le, "note.txt")).toBe("text/plain")
  })

  it("uses the extension to disambiguate an audio-only MP4 container", () => {
    expect(Mime.detect(ftyp("isom"), "clip.m4a")).toBe("audio/mp4")
    expect(Mime.detect(ftyp("mp42"), "clip.m4a")).toBe("audio/mp4")
    expect(Mime.detect(ftyp("isom"), "sound.aac")).toBe("audio/aac")
    expect(Mime.detect(ftyp("isom"), "clip.mp4")).toBe("video/mp4")
  })
})
