import { expect, test } from "bun:test"
import { basic, basicHeader } from "../../src/proxy/auth/basic"
import { selectProviders } from "../../src/proxy/auth/provider"

test("basic header encodes credentials", () => {
  expect(basicHeader("u", "p")).toBe("Basic " + Buffer.from("u:p").toString("base64"))
})

test("selectProviders honors auto order", () => {
  expect(selectProviders("auto", ["NTLM", "Negotiate", "Basic"]).map((provider) => provider.scheme)).toEqual([
    "negotiate",
    "ntlm",
    "basic",
  ])
})

test("explicit mechanism narrows selection", () => {
  expect(selectProviders("basic", ["Negotiate", "Basic"]).map((provider) => provider.scheme)).toEqual(["basic"])
  expect(selectProviders("none", ["Negotiate", "Basic"])).toEqual([])
})

test("basic step returns undefined when no credentials", async () => {
  expect(await basic.step({ proxy: new URL("http://p:8080"), target: "https://a/" }, 'Basic realm="p"')).toBeUndefined()
})
