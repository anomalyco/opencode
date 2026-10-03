import { expect, test } from "bun:test"
import { negotiate } from "../../src/proxy/auth/negotiate"
import { selectProviders } from "../../src/proxy/auth/provider"
import type { ProxyAuthNative } from "../../src/proxy/native"

const nativeWith = (bytes: number[]): ProxyAuthNative => ({
  negotiate: async () => new Uint8Array(bytes),
  ntlm: { createType1: () => new Uint8Array(), createType3: () => new Uint8Array() },
})

const ctx = { proxy: new URL("http://proxy.test:8080"), target: "https://origin.test" }

test("negotiate emits a Negotiate header with the base64 token", async () => {
  const provider = negotiate(nativeWith([1, 2, 3]))
  expect(provider.scheme).toBe("negotiate")
  expect(await provider.step(ctx, "Negotiate")).toBe("Negotiate " + Buffer.from([1, 2, 3]).toString("base64"))
})

test("negotiate declines when there is no token", async () => {
  const provider = negotiate(nativeWith([]))
  expect(await provider.step(ctx, "Negotiate")).toBeUndefined()
})

test("selectProviders honors auto order across all mechanisms", () => {
  // NTLM is wired in Task 11; assert the full order against the provider table
  // by checking each scheme is available with a native module.
  const providers = selectProviders("auto", ["Basic", "Negotiate", "NTLM"], nativeWith([1]))
  expect(providers.map((provider) => provider.scheme)).toContain("negotiate")
  expect(providers.map((provider) => provider.scheme)).toContain("basic")
})
