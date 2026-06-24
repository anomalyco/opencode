import { expect, test } from "bun:test"
import { helloWorld } from "../../../src/evolution-rsi/hello.ts"

test("helloWorld mengembalikan teks yang mengandung 'Hello'", () => {
  const hasil = helloWorld()
  expect(typeof hasil).toBe("string")
  expect(hasil).toContain("Hello")
})
