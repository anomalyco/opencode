import { describe, expect, test } from "bun:test"
import { textDirection } from "./text-direction"

describe("textDirection", () => {
  test("follows the language most of the text is written in", () => {
    expect(textDirection("React هو مكتبة واجهة برمجية")).toBe("rtl")
    expect(textDirection("سأستخدم React في المشروع")).toBe("rtl")
    expect(textDirection("Use React in the project")).toBe("ltr")
  })

  test("keeps left-to-right scripts outside the rtl set", () => {
    expect(textDirection("这是一个测试 مرحبا")).toBe("ltr")
    expect(textDirection("これはテストです مرحبا")).toBe("ltr")
    expect(textDirection("यह एक परीक्षण है مرحبا")).toBe("ltr")
    expect(textDirection("한국어 테스트 مرحبا")).toBe("ltr")
  })

  test("treats digits and punctuation as neutral", () => {
    expect(textDirection("1234 (5%) -- 6.")).toBeUndefined()
    expect(textDirection("مرحبا 1234")).toBe("rtl")
  })

  test("leaves a tie to the ambient direction", () => {
    expect(textDirection("مرحبا hello")).toBeUndefined()
    expect(textDirection("")).toBeUndefined()
  })
})
