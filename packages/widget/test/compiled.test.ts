import { expect, test } from "bun:test"
import { compiled } from "../src/compiled.js"

test("a program is compiled once, the cache keeps the 32 last used, and code that doesn't compile stays text", () => {
  const first = compiled("return 1")
  expect(typeof first).not.toBe("string")
  expect(compiled("return 1")).toBe(first)
  Array.from({ length: 31 }, (_, index) => compiled(`return ${index + 2}`))
  expect(compiled("return 1")).toBe(first)
  Array.from({ length: 32 }, (_, index) => compiled(`return ${index + 100}`))
  expect(compiled("return 1")).not.toBe(first)
  expect(compiled("return (")).toBe("return (")
})
