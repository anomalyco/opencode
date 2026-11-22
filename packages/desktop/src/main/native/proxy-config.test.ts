import { expect, test } from "bun:test"
import { defaultProxySettings, proxyBypass, proxyEnvironment, proxyRules, readProxySettings } from "./proxy-config"

test("missing or malformed stored settings fall back to a disabled proxy", () => {
  expect(readProxySettings(undefined)).toEqual(defaultProxySettings)
  expect(readProxySettings({ enabled: true, http: 42 })).toEqual(defaultProxySettings)
  expect(readProxySettings({ enabled: true })).toEqual({ ...defaultProxySettings, enabled: true })
})

test("a disabled proxy contributes no environment variables or rules", () => {
  const value = { enabled: false, http: "http://127.0.0.1:7890", https: "http://127.0.0.1:7890", noProxy: "" }

  expect(proxyEnvironment(value)).toEqual({})
  expect(proxyRules(value)).toBeUndefined()
})

test("an enabled proxy sets both spellings of the proxy variables and merges existing bypasses", () => {
  const value = {
    enabled: true,
    http: "http://127.0.0.1:7890",
    https: "socks5://127.0.0.1:7891",
    noProxy: "localhost, .internal,127.0.0.1",
  }
  const existing = { NO_PROXY: "internal.local", no_proxy: "internal.local,foo" }

  expect(proxyEnvironment(value, existing)).toEqual({
    HTTP_PROXY: "http://127.0.0.1:7890",
    http_proxy: "http://127.0.0.1:7890",
    HTTPS_PROXY: "socks5://127.0.0.1:7891",
    https_proxy: "socks5://127.0.0.1:7891",
    NO_PROXY: "localhost,.internal,127.0.0.1,::1,internal.local,foo",
    no_proxy: "localhost,.internal,127.0.0.1,::1,internal.local,foo",
  })
  expect(proxyBypass(value)).toBe("localhost,.internal,127.0.0.1,::1")
})

test("a blank URL does not overwrite the matching environment variable", () => {
  const environment = proxyEnvironment({ enabled: true, http: "", https: "http://proxy:8080", noProxy: "" })

  expect(environment).toEqual({
    HTTPS_PROXY: "http://proxy:8080",
    https_proxy: "http://proxy:8080",
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  })
})

test("electron uses the https URL when both are set, or the http URL alone", () => {
  expect(
    proxyRules({ enabled: true, http: "http://127.0.0.1:7890", https: "socks5://127.0.0.1:7891", noProxy: "" }),
  ).toBe("socks5://127.0.0.1:7891")
  expect(proxyRules({ enabled: true, http: "http://127.0.0.1:7890", https: "", noProxy: "" })).toBe(
    "http://127.0.0.1:7890",
  )
})
