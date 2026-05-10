import { describe, expect, test } from "bun:test"

describe("app session route provider topology", () => {
  test("routes sessions through SessionProviders and its BrowserProvider", async () => {
    const app = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const sessionProviders = await Bun.file(new URL("./session-providers.tsx", import.meta.url)).text()

    expect(app).toContain('import { SessionProviders } from "@/session-providers"')
    expect(app).toContain("const SessionRoute = () => (")
    expect(app).toContain("<SessionProviders>\n    <Session />\n  </SessionProviders>")
    expect(app).toContain('<Route path="/session/:id?" component={SessionRoute} />')
    expect(sessionProviders).toContain('import { BrowserProvider } from "@/context/browser-store"')
    expect(sessionProviders).toContain("createComponent(BrowserProvider")
  })
})
