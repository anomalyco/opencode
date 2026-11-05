import { describe, expect, test } from "bun:test"
import { legacyRedirect } from "../src/lib/legacy"

const get = (path: string, options: { search?: string; method?: string; locale?: "de" | null } = {}) =>
  legacyRedirect({
    path,
    search: options.search ?? "",
    method: options.method ?? "GET",
    locale: options.locale ?? null,
  })

describe("legacy redirects", () => {
  test("desktop downloads go straight to the update API, HEAD included", () => {
    for (const method of ["GET", "HEAD"]) {
      const response = get("/download/latest/windows-x64-nsis", { method })
      expect(response?.status).toBe(302)
      expect(response?.headers.get("Location")).toBe(
        "https://opencode.ai/update/api/latest/desktop/opencode/opencode-desktop-win-x64.exe",
      )
    }
    expect(get("/download/stable/linux-x64-deb")?.headers.get("Location")).toBe(
      "https://opencode.ai/update/api/latest/desktop/opencode/opencode-desktop-linux-amd64.deb",
    )
    expect(get("/download/beta/darwin-aarch64-dmg")?.headers.get("Location")).toBe(
      "https://opencode.ai/update/api/beta/desktop/opencode/opencode-desktop-mac-arm64.dmg",
    )
    expect(get("/download/latest/not-a-platform")?.status).toBe(404)
    expect(get("/download/latest/toString")?.status).toBe(404)
    expect(get("/download/latest/windows-x64-nsis", { method: "POST" })).toBeUndefined()
  })

  test("moved pages match exact paths only, keep the query and leave the inference API alone", () => {
    const zen = get("/zen/", { search: "?ref=app" })
    expect(zen?.status).toBe(302)
    expect(zen?.headers.get("Location")).toBe("/console/models?ref=app")
    expect(zen?.headers.get("Cache-Control")).toBe("no-store")
    expect(get("/zen/go")?.headers.get("Location")).toBe("/console/go")
    expect(get("/teams")?.headers.get("Location")).toBe("/console/teams")
    for (const path of ["/zen/v1/models", "/zen/go/v1/chat/completions", "/go/v1", "/models.json", "/gopher"])
      expect(get(path)).toBeUndefined()
    expect(get("/go", { method: "POST" })).toBeUndefined()
  })

  test("localized go, zen and enterprise follow to the Console; other localized moves don't", () => {
    expect(get("/enterprise", { locale: "de" })?.headers.get("Location")).toBe("/console/enterprise")
    expect(get("/pricing", { locale: "de" })).toBeUndefined()
  })

  test("the old dashboard, Black, stats and share links", () => {
    const auth = get("/workspace/wrk_123/go", { method: "POST", locale: "de" })
    expect(auth?.status).toBe(302)
    expect(auth?.headers.get("Location")).toBe("https://opencode.ai/console/login")
    expect(auth?.headers.get("Cache-Control")).toBe("no-store")
    expect(get("/authorize")).toBeUndefined()
    expect(get("/black/plans")?.status).toBe(301)
    expect(get("/black/plans")?.headers.get("Location")).toBe("/console/go")
    const stats = get("/stats/models", { search: "?range=7d", method: "POST", locale: "de" })
    expect(stats?.status).toBe(308)
    expect(stats?.headers.get("Location")).toBe("/data/models?range=7d")
    expect(get("/stats")?.headers.get("Location")).toBe("/data")
    expect(get("/stats/")?.headers.get("Location")).toBe("/data/")
    expect(get("/statsig")).toBeUndefined()
    const share = get("/s/abc123")
    expect(share?.status).toBe(301)
    expect(share?.headers.get("Location")).toBe("https://opncd.ai/share/abc123")
  })

  test("site pages pass through", () => {
    for (const path of ["/", "/product", "/download", "/brand", "/changelog", "/legal/privacy-policy"])
      expect(get(path)).toBeUndefined()
  })
})
