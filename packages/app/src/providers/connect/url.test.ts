import { describe, expect, test } from "bun:test"
import { providerAuthUrl } from "./url"

describe("providerAuthUrl", () => {
  const url = "https://opencode.ai/console/device?user_code=ABCD-1234&client_id=opencode-cli#confirm"

  test("identifies OpenCode Desktop without changing the device code or URL target", () => {
    const result = new URL(providerAuthUrl(url, "opencode", "desktop"))
    expect(result.searchParams.has("application")).toBe(false)
    expect(result.searchParams.get("user_code")).toBe("ABCD-1234")
    expect(result.searchParams.get("client_id")).toBe("opencode-desktop")
    expect(result.origin).toBe("https://opencode.ai")
    expect(result.pathname).toBe("/console/device")
    expect(result.hash).toBe("#confirm")
  })

  test("replaces the client ID for custom Console servers", () => {
    const result = new URL(
      providerAuthUrl("https://console.example.com/device?client_id=opencode-cli", "opencode", "desktop"),
    )
    expect(result.origin).toBe("https://console.example.com")
    expect(result.searchParams.getAll("client_id")).toEqual(["opencode-desktop"])
  })

  test("leaves the web flow unchanged", () => {
    expect(providerAuthUrl(url, "opencode", "web")).toBe(url)
  })

  test("leaves other providers unchanged", () => {
    expect(providerAuthUrl(url, "openai", "desktop")).toBe(url)
    expect(providerAuthUrl("https://github.com/login/device", "github-copilot", "desktop")).toBe(
      "https://github.com/login/device",
    )
  })
})
