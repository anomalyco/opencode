import { describe, it, expect } from "bun:test"
import { Sanitizer } from "@/muel/sanitizer"

function s(): Sanitizer { return new Sanitizer() }

describe("sanitizeInput", () => {
  it("fast path: no dangerous chars passes through correctly", () => {
    expect(s().sanitizeInput("hello world 123")).toBe("hello world 123")
  })

  it("strips zero-width space U+200B", () => {
    expect(s().sanitizeInput("12\u200B+3")).toBe("12+3")
  })

  it("strips zero-width joiner U+200D", () => {
    expect(s().sanitizeInput("5\u200D*2=10")).toBe("5*2=10")
  })

  it("strips BOM U+FEFF", () => {
    expect(s().sanitizeInput("\uFEFF2+2=4")).toBe("2+2=4")
  })

  it("strips bidi override U+202E", () => {
    expect(s().sanitizeInput("10\u202E+10=20")).toBe("10+10=20")
  })

  it("rejects null byte", () => {
    expect(s().sanitizeInput("5\0+3=8")).toBe("5+3=8")
  })

  it("normalizes × to *", () => {
    expect(s().sanitizeInput("2×3=6")).toBe("2*3=6")
  })

  it("normalizes ÷ to /", () => {
    expect(s().sanitizeInput("10÷2=5")).toBe("10/2=5")
  })

  it("normalizes − (minus sign) to -", () => {
    expect(s().sanitizeInput("5−3=2")).toBe("5-3=2")
  })

  it("handles empty string", () => {
    expect(s().sanitizeInput("")).toBe("")
  })

  it("handles string with only safe chars", () => {
    const input = "Hitung 100 + 200 * 3"
    expect(s().sanitizeInput(input) === input).toBe(true)
  })

  it("standardizes EU number format 1.234,56", () => {
    expect(s().sanitizeInput("total 1.234,56")).toBe("total 1234.56")
  })

  it("passes through US number format 1,234.56", () => {
    expect(s().sanitizeInput("total 1,234.56")).toBe("total 1,234.56")
  })

  it("resolves ambiguous 3-digit comma to US thousands: 123,456", () => {
    expect(s().sanitizeInput("Rp 123,456")).toBe("Rp 123456")
  })

  it("performs NFC normalization", () => {
    const composed = "\u00E9" // é precomposed
    const decomposed = "\u0065\u0301" // e + combining acute
    expect(s().sanitizeInput(decomposed)).toBe(composed)
  })
})

describe("sanitizeOutput", () => {
  it("fast path: no dangerous chars returns same reference", () => {
    const input = "Menurut saya jawabannya 17"
    expect(s().sanitizeOutput(input) === input).toBe(true)
  })

  it("strips zero-width space from output", () => {
    expect(s().sanitizeOutput("25\u200B")).toBe("25")
  })

  it("strips bidi override from output", () => {
    expect(s().sanitizeOutput("jawab\u202E: 17")).toBe("jawab: 17")
  })

  it("handles empty output chunk", () => {
    expect(s().sanitizeOutput("")).toBe("")
  })

  it("does NOT normalize operators (output left as-is)", () => {
    const chunk = "2×3=6"
    expect(s().sanitizeOutput(chunk) === chunk).toBe(true)
  })

  it("handles null byte in output", () => {
    expect(s().sanitizeOutput("17\0")).toBe("17")
  })
})

describe("normalizeNumbers", () => {
  it("standardizes EU format 1.234,56", () => {
    expect(s().normalizeNumbers("total 1.234,56")).toBe("total 1234.56")
  })

  it("passes through US format 1,234.56", () => {
    expect(s().normalizeNumbers("total 1,234.56")).toBe("total 1,234.56")
  })

  it("resolves ambiguous 3-digit to US thousands: Rp 123,456", () => {
    expect(s().normalizeNumbers("Rp 123,456")).toBe("Rp 123456")
  })

  it("handles no numbers present", () => {
    const input = "hello world"
    expect(s().normalizeNumbers(input) === input).toBe(true)
  })

  it("handles multiple EU numbers in one string", () => {
    expect(s().normalizeNumbers("1.234,56 + 2.345,67 = 3.580,23"))
      .toBe("1234.56 + 2345.67 = 3580.23")
  })

  it("handles multiple US numbers in one string", () => {
    expect(s().normalizeNumbers("1,234.56 + 2,345.67 = 3,580.23"))
      .toBe("1,234.56 + 2,345.67 = 3,580.23")
  })

  it("handles mixed EU/US string (detects EU first)", () => {
    expect(s().normalizeNumbers("US: 1,234.56 EU: 1.234,56"))
      .toBe("US: 1.23456 EU: 1234.56")
  })

  it("passes through simple integer 12345", () => {
    expect(s().normalizeNumbers("12345")).toBe("12345")
  })
})
