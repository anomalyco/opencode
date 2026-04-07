import { afterEach, describe, expect, test } from "bun:test"
import { HttpClientError, HttpClientRequest } from "effect/unstable/http"

import { AccountServiceError } from "../../src/account/schema"
import { FormatError } from "../../src/cli/error"

const proxyEnvVarNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const
const originalEnv = new Map(proxyEnvVarNames.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of proxyEnvVarNames) {
    const value = originalEnv.get(name)
    if (value === undefined) {
      delete process.env[name]
      continue
    }

    process.env[name] = value
  }
})

describe("cli.error", () => {
  test("formats account transport errors with a proxy hint when proxy env vars are set", () => {
    process.env.HTTPS_PROXY = "http://proxy.internal:8080"

    const error = new AccountServiceError({
      message: "HTTP request failed",
      cause: new HttpClientError.TransportError({
        request: HttpClientRequest.post("https://console.opencode.ai/auth/device/code"),
      }),
    })

    const formatted = FormatError(error)

    expect(formatted).toContain("Could not reach POST https://console.opencode.ai/auth/device/code.")
    expect(formatted).toContain("This failed before the server returned an HTTP response.")
    expect(formatted).toContain("HTTPS_PROXY")
  })
})
