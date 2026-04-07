import { describe, expect, test } from "bun:test"
import { HttpClientError, HttpClientRequest } from "effect/unstable/http"

import { AccountServiceError } from "../../src/account/schema"
import { FormatError } from "../../src/cli/error"

describe("cli.error", () => {
  test("formats account transport errors clearly", () => {
    const error = new AccountServiceError({
      message: "HTTP request failed",
      cause: new HttpClientError.TransportError({
        request: HttpClientRequest.post("https://console.opencode.ai/auth/device/code"),
      }),
    })

    const formatted = FormatError(error)

    expect(formatted).toContain("Could not reach POST https://console.opencode.ai/auth/device/code.")
    expect(formatted).toContain("This failed before the server returned an HTTP response.")
    expect(formatted).toContain("Check your network, proxy, or VPN configuration and try again.")
  })
})
