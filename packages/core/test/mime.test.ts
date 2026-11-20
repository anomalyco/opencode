import { describe, expect, test } from "bun:test"
import { Mime } from "@opencode/core/mime"

const ftyp = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"))

describe("Mime.detect", () => {
  test.each([
    [Uint8Array.of(65), "text/plain"],
    [Uint8Array.of(0xff), "application/octet-stream"],
    [Uint8Array.of(0xe2, 0x82), "text/plain"], // A sample may end inside a UTF-8 character.
  ] as const)("leaves samples without media headers to the text fallback: %j", (bytes, mime) => {
    expect(Mime.detectMedia(bytes)).toBeUndefined()
    expect(Mime.detect(bytes)).toBe(mime)
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
    expect(Mime.detect(ftyp("000000206674797061766966000000004d695072617669666d6961666d696631"))).toBe("image/avif")
    expect(Mime.detect(ftyp("000000186674797061766973000000006d73663161766973"))).toBe("image/avif")
    expect(Mime.detect(ftyp("00000018667479706d69663100000000617669666d69663100000000"))).toBe("image/avif")
    expect(Mime.detect(ftyp("000000246674797068656963000000006d6966314d6950726d6961664d694842"))).toBe("image/heic")
    expect(Mime.detect(ftyp("00000018667479706d69663100000000686569636d69663100000000"))).toBe("image/heic")
    expect(Mime.detect(ftyp("000000206674797069736f6d0000020069736f6d69736f32617663316d703431"))).toBe("video/mp4")
    expect(Mime.detect(ftyp("00000014667479707174202000000200717420200000000877696465"))).toBe("video/quicktime")
    expect(Mime.detect(ftyp("0000001c667479704d344120000002004d34412069736f6d69736f3200000008"))).toBe("audio/mp4")
  })
})
