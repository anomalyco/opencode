import { afterEach, describe, expect, test } from "bun:test"
import { sha256Hex, sha256Sync } from "./sha256"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")

const setCrypto = (value: unknown) => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value,
  })
}

afterEach(() => {
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  }
})

const vectors: Array<[string, string]> = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmnlmnomnopnopq",
    "a57ed99266a7c7be3eaee2ffa23f54ff042a4829fa036cf5ea83d7e3de0c666e",
  ],
  [
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
  ],
]

describe("sha256Hex", () => {
  test("matches known vectors via crypto.subtle", async () => {
    for (const [input, expected] of vectors) {
      expect(await sha256Hex(new TextEncoder().encode(input))).toBe(expected)
    }
  })

  test("matches crypto.subtle output", async () => {
    const data = new TextEncoder().encode("opencode")
    const native = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
    expect(await sha256Hex(data)).toBe(native)
  })

  test("falls back without crypto.subtle (insecure contexts)", async () => {
    setCrypto({})
    for (const [input, expected] of vectors) {
      expect(await sha256Hex(new TextEncoder().encode(input))).toBe(expected)
    }
  })

  test("falls back when crypto is missing entirely", async () => {
    setCrypto(undefined)
    for (const [input, expected] of vectors) {
      expect(await sha256Hex(new TextEncoder().encode(input))).toBe(expected)
    }
  })

  test("handles multi-block input (one million 'a')", async () => {
    setCrypto({})
    expect(await sha256Hex(new Uint8Array(1_000_000).fill(97))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    )
  })

  test("sha256Sync matches sha256Hex", async () => {
    const data = new TextEncoder().encode("cross-check")
    expect(Buffer.from(sha256Sync(data)).toString("hex")).toBe(await sha256Hex(data))
  })
})
