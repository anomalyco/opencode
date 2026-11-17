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

  test("finds a PDF header within the first kilobyte", () => {
    const pdf = (prefix: string) =>
      Buffer.concat([
        Buffer.from(prefix),
        Buffer.from("%PDF-1.7\n%"),
        Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]),
        Buffer.from("\n"),
      ])
    expect(Mime.detect(pdf(""))).toBe("application/pdf")
    expect(Mime.detect(pdf("\r\n"))).toBe("application/pdf")
    expect(Mime.detect(pdf("x".repeat(1000)))).toBe("application/pdf")
    expect(Mime.detect(pdf("x".repeat(2000)))).toBe("application/octet-stream")
    expect(Mime.detect(pdf("\uFEFF"))).toBe("application/pdf")
  })

  test("leaves containers with a PDF member to the binary fallback", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n%"), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from("\n")])
    const tar = Buffer.alloc(512)
    tar.write("doc.pdf")
    tar.write("0000644\0", 100)
    tar.write("ustar\0", 257)
    const zip = Buffer.concat([
      Buffer.from("504b03040a0000000000" + "00".repeat(16) + "07000000", "hex"),
      Buffer.from("doc.pdf"),
    ])
    for (const bytes of [tar, zip]) expect(Mime.detect(Buffer.concat([bytes, pdf]))).toBe("application/octet-stream")
  })

  test("keeps text mentioning a PDF header as text", () => {
    for (const text of ["Every PDF starts with %PDF-1.7 on its first line.\n", "header:\n%PDF-2.0\n"])
      expect(Mime.detect(Buffer.from(text))).toBe("text/plain")
    for (const text of [
      "Café notes: %PDF-1.4 header\n",
      "Notes: %PDF-1.4 header, café\n",
      "header:\n%PDF-1.4\nrésumé\n",
    ])
      expect(Mime.detectMedia(Buffer.from(text, "latin1"))).toBeUndefined()
  })

  test("detects WebM from its EBML DocType", () => {
    const webm = ftyp("1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102")
    const matroska = ftyp("1a45dfa39f4286810142f7810142f2810442f381084282886d6174726f736b614287810442858102")
    expect(Mime.detect(webm)).toBe("video/webm")
    expect(Mime.detectMedia(matroska)).toBeUndefined()
    expect(Mime.detect(matroska)).toBe("application/octet-stream")
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
