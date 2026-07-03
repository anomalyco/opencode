import { describe, expect, test } from "bun:test"
import { googleHelper } from "../src/routes/zen/util/provider/google"

describe("googleHelper", () => {
  test("uses x-goog-api-key without forwarding bearer auth", () => {
    const headers = new Headers({ authorization: "Bearer opencode-project-key" })
    const provider = googleHelper({ reqModel: "gemini-3-flash", providerModel: "gemini-3-flash" })

    provider.modifyHeaders(headers, "google-provider-key", "sticky")

    expect(headers.get("authorization")).toBeNull()
    expect(headers.get("x-goog-api-key")).toBe("google-provider-key")
  })
})
