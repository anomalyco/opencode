import { expect, test } from "bun:test"
import { basic, basicHeader } from "../../src/proxy/auth/basic"
import { selectProviders } from "../../src/proxy/auth/provider"
import type { ProxyAuthNative } from "../../src/proxy/native"

const native: ProxyAuthNative = {
  negotiate: async () => new Uint8Array([1]),
  ntlm: { createType1: () => new Uint8Array([1]), createType3: () => new Uint8Array([1]) },
}

test("basic header encodes credentials", () => {
  expect(basicHeader("u", "p")).toBe("Basic " + Buffer.from("u:p").toString("base64"))
})

test("selectProviders honors auto order when negotiate and ntlm are available", () => {
  expect(selectProviders("auto", ["Basic", "Negotiate"], native).map((provider) => provider.scheme)).toEqual([
    "negotiate",
    "basic",
  ])
})

test("selectProviders degrades to basic without a native module", () => {
  expect(selectProviders("auto", ["NTLM", "Negotiate", "Basic"]).map((provider) => provider.scheme)).toEqual(["basic"])
})

test("explicit mechanism narrows selection", () => {
  expect(selectProviders("basic", ["Negotiate", "Basic"], native).map((provider) => provider.scheme)).toEqual(["basic"])
  expect(selectProviders("none", ["Negotiate", "Basic"], native)).toEqual([])
})

test("basic step returns undefined when no credentials", async () => {
  expect(await basic.step({ proxy: new URL("http://p:8080"), target: "https://a/" }, 'Basic realm="p"')).toBeUndefined()
})
