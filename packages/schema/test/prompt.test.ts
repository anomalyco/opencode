import { Schema } from "effect"
import { expect, test } from "bun:test"
import { Base64 } from "../src/prompt.js"

const accepts = (value: string) => expect(Schema.is(Base64)(value)).toBe(true)
const rejects = (value: string) => expect(Schema.is(Base64)(value)).toBe(false)

test("accepts canonical base64", () => {
  accepts("")
  accepts("ABCD")
  accepts("AB==")
  accepts("ABC=")
  accepts("ABCDAB==")
  accepts("AQgw+/9=")
})

test("rejects non-canonical base64", () => {
  rejects("AB=")
  rejects("ABCD==")
  rejects("ABCDE=")
  rejects("A===")
  rejects("AB")
  rejects("A")
  rejects("====")
  rejects("==AB")
  rejects("AB!D")
  rejects("ABCD\n")
  rejects("aqz9-_")
})

test("accepts multi-megabyte payloads the old grouped-quantifier pattern failed on", () => {
  // 20 MB is the prompt-attachment limit; its base64 is ~27.9M chars.
  const bytes = new Uint8Array(20 * 1024 * 1024)
  crypto.getRandomValues(bytes)
  const encoded = Buffer.from(bytes).toString("base64")
  const start = performance.now()
  accepts(encoded)
  expect(performance.now() - start).toBeLessThan(5_000)
})
