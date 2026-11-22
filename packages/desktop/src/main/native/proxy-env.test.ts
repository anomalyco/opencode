import { expect, test } from "bun:test"
import { createProxyEnvironment } from "./proxy-env"

const enabled = { enabled: true, http: "http://proxy:8080", https: "", noProxy: "internal.local" }
const disabled = { ...enabled, enabled: false }

test("enabling writes proxy variables and merges the existing bypass list", () => {
  const env: Record<string, string | undefined> = { NO_PROXY: "legacy.local" }

  createProxyEnvironment()(enabled, env)

  expect(env.HTTP_PROXY).toBe("http://proxy:8080")
  expect(env.http_proxy).toBe("http://proxy:8080")
  expect(env.NO_PROXY).toBe("internal.local,127.0.0.1,localhost,::1,legacy.local")
  expect(env.HTTPS_PROXY).toBeUndefined()
})

test("disabling restores the values the user had before launch, including missing keys", () => {
  const env: Record<string, string | undefined> = {
    HTTPS_PROXY: "http://system:8080",
    NO_PROXY: "legacy.local",
  }
  const apply = createProxyEnvironment()

  apply(enabled, env)
  apply(disabled, env)

  expect(env).toEqual({ HTTPS_PROXY: "http://system:8080", NO_PROXY: "legacy.local" })
})

test("the disabled setting never touches an environment it did not change", () => {
  const env: Record<string, string | undefined> = { HTTP_PROXY: "http://system:8080" }
  const apply = createProxyEnvironment()

  apply(disabled, env)

  expect(env).toEqual({ HTTP_PROXY: "http://system:8080" })
})
