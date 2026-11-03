import { describe, expect, test } from "bun:test"
import { Mime } from "@opencode/core/mime"

const ftyp = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"))

describe("Mime.detect", () => {
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
