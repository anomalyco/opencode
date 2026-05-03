import { describe, expect, test } from "bun:test"

describe("index html shell", () => {
  test("uses relative asset and entry paths so the app can mount under a subpath", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text()

    expect(html).toContain('href="./favicon-v3.svg"')
    expect(html).toContain('src="./src/entry.tsx"')
    expect(html).toContain('src="./oc-theme-preload.js"')
  })
})
