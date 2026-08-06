import { describe, expect, test } from "bun:test"
import { mathExtension } from "./math-extension"

const inline = mathExtension[0].extensions![0]
const block = mathExtension[0].extensions![1]

/** marked 17 行为:tokenizer 收到从 start 位置开始的剩余串 */
function sliceStart(src: string, start: (s: string) => number | undefined, tokenizer: (s: string) => unknown) {
  const pos = start(src)
  if (pos === undefined || pos < 0) return undefined
  return tokenizer(src.slice(pos))
}

describe("mathExtension", () => {
  test("inline math converts to unicode text token", () => {
    const t = sliceStart("the model $y = \\beta_1 x$ is linear", inline.start!, inline.tokenizer!)
    expect(t).toBeTruthy()
    expect((t as any).type).toBe("math")
    expect((t as any).text).toContain("β₁")
    expect((t as any).text).not.toContain("$")
  })
  test("inline tokenizer skips currency", () => {
    expect(sliceStart("costs $0.02 per unit", inline.start!, inline.tokenizer!)).toBeUndefined()
    expect(sliceStart("price is $5 today", inline.start!, inline.tokenizer!)).toBeUndefined()
  })
  test("inline tokenizer handles escaped dollar inside", () => {
    const t = sliceStart("price $p = \\$5$ today", inline.start!, inline.tokenizer!)
    expect(t).toBeTruthy()
    expect((t as any).text).toContain("$5")
  })
  test("start finds dollar positions", () => {
    expect(inline.start!("no dollar here")).toBe(-1)
    expect(inline.start!("a $b c$")).toBe(2)
  })
  test("block tokenizer produces mathBlock", () => {
    const t = block.tokenizer!("$$y = \\beta_0 + \\beta_1 x$$\n\nafter")
    expect(t).toBeTruthy()
    expect((t as any).type).toBe("mathBlock")
    expect((t as any).text).toContain("β₁")
  })
  test("block tokenizer requires non-empty body", () => {
    expect(block.tokenizer!("$$\n$$\nafter")).toBeUndefined()
  })
})
