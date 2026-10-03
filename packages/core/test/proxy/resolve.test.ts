import { expect, test } from "bun:test"
import { isLoopback, resolve } from "../../src/proxy/resolve"

test("config url wins over env", () => {
  const settings = resolve({
    config: { url: "http://cfg:8080" } as any,
    env: { HTTPS_PROXY: "http://env:8080" },
    target: "https://a.test/",
  })
  expect(settings.url?.host).toBe("cfg:8080")
})

test("env is used when config is absent", () => {
  const settings = resolve({ env: { HTTPS_PROXY: "http://env:8080" }, target: "https://a.test/" })
  expect(settings.url?.host).toBe("env:8080")
})

test("no_proxy wildcard and port entries force direct", () => {
  expect(
    resolve({ env: { HTTPS_PROXY: "http://p:8080", NO_PROXY: "*.test,other:443" }, target: "https://a.test/" }).url,
  ).toBeUndefined()
  expect(
    resolve({ env: { HTTPS_PROXY: "http://p:8080", NO_PROXY: "other:443" }, target: "https://a.other/" }).url,
  ).toBeDefined()
})

test("loopback is always direct", () => {
  expect(isLoopback("127.0.0.1")).toBe(true)
  expect(isLoopback("::1")).toBe(true)
  expect(isLoopback("[::1]")).toBe(true)
  expect(resolve({ env: { HTTPS_PROXY: "http://p:8080" }, target: "http://127.0.0.1:9000/" }).url).toBeUndefined()
})

test("url userinfo becomes username/password", () => {
  const settings = resolve({ env: { HTTPS_PROXY: "http://u:p@proxy:8080" }, target: "https://a.test/" })
  expect(settings.username).toBe("u")
  expect(settings.password).toBe("p")
})

test("password {env:VAR} is expanded from the environment", () => {
  const settings = resolve({
    config: { password: "{env:PROXY_PASSWORD}" } as any,
    env: { HTTPS_PROXY: "http://proxy:8080", PROXY_PASSWORD: "s3cret" },
    target: "https://a.test/",
  })
  expect(settings.password).toBe("s3cret")
})

test("a literal password is preserved", () => {
  const settings = resolve({
    config: { password: "literal" } as any,
    env: { HTTPS_PROXY: "http://proxy:8080" },
    target: "https://a.test/",
  })
  expect(settings.password).toBe("literal")
})
