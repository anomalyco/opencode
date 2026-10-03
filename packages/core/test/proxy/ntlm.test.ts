import { expect, test } from "bun:test"
import { ntlm } from "../../src/proxy/auth/ntlm"
import type { ProxyAuthNative } from "../../src/proxy/native"

const native: ProxyAuthNative = {
  negotiate: async () => new Uint8Array(),
  ntlm: {
    createType1: () => new Uint8Array([1, 2, 3]),
    createType3: () => new Uint8Array([4, 5, 6]),
  },
}

const ctx = { proxy: new URL("http://proxy.test:8080"), target: "https://origin.test", username: "u", password: "p" }

function type2(): string {
  const bytes = Buffer.concat([Buffer.from("NTLMSSP\0", "latin1"), Buffer.from([2, 0, 0, 0]), Buffer.alloc(20)])
  return "NTLM " + bytes.toString("base64")
}

test("ntlm emits a Type1 message when the challenge has no token", async () => {
  const provider = ntlm(native)
  expect(provider.scheme).toBe("ntlm")
  expect(await provider.step(ctx, "NTLM")).toBe("NTLM " + Buffer.from([1, 2, 3]).toString("base64"))
})

test("ntlm emits a Type3 message when the challenge carries a Type2 token", async () => {
  const provider = ntlm(native)
  expect(await provider.step(ctx, type2())).toBe("NTLM " + Buffer.from([4, 5, 6]).toString("base64"))
})
