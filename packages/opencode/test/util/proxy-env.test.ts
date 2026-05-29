import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProxyEnv } from "../../src/util/proxy-env"

const keys = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
]
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

beforeEach(() => {
  for (const key of keys) delete process.env[key]
})

afterEach(() => {
  for (const key of keys) restoreEnv(key, original[key])
})

describe("util.proxy-env", () => {
  test("uses protocol-specific proxies before ALL_PROXY", () => {
    process.env.http_proxy = "http://lower-proxy:8080"
    process.env.HTTP_PROXY = "http://upper-proxy:8080"
    process.env.ALL_PROXY = "http://fallback-proxy:8080"

    expect(ProxyEnv.getProxyForUrl("http://example.com/path")).toBe("http://lower-proxy:8080")
    expect(ProxyEnv.getProxyForUrl("https://example.com/path")).toBe("http://fallback-proxy:8080")
  })

  test("adds the target protocol to proxy values without a scheme", () => {
    process.env.HTTPS_PROXY = "proxy.example.com:8080"

    expect(ProxyEnv.getProxyForUrl("https://example.com/path")).toBe("https://proxy.example.com:8080")
  })

  test("honors NO_PROXY hosts, domain suffixes, ports, and wildcard bypass", () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080"
    process.env.NO_PROXY = "api.openai.com,.internal.example,service.example:8443"

    expect(ProxyEnv.getProxyForUrl("https://api.openai.com/v1/responses")).toBeUndefined()
    expect(ProxyEnv.getProxyForUrl("https://api.internal.example/v1/responses")).toBeUndefined()
    expect(ProxyEnv.getProxyForUrl("https://service.example/v1/responses")).toBe("http://proxy.example.com:8080")
    expect(ProxyEnv.getProxyForUrl("https://service.example:8443/v1/responses")).toBeUndefined()

    process.env.NO_PROXY = "*"
    expect(ProxyEnv.getProxyForUrl("https://other.example/v1/responses")).toBeUndefined()
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
