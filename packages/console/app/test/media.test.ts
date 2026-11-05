import { describe, expect, test } from "bun:test"
import { mediaBase, mediaRedirect } from "../src/lib/media"

describe("media redirect", () => {
  test("sends heavy media to opencode.ai/files/site/<version> at the same path", () => {
    expect(mediaBase).toBe("https://opencode.ai/files/site/2026-11")
    const response = mediaRedirect("/product-videos/heroes/sdk-landscape-dark.mp4", "?v=2")
    expect(response?.status).toBe(302)
    expect(response?.headers.get("Location")).toBe(`${mediaBase}/product-videos/heroes/sdk-landscape-dark.mp4?v=2`)
  })

  test("leaves pages, images, build files, download routes and the files route alone", () => {
    for (const path of [
      "/",
      "/product",
      "/brand/files/opencode-logo-dark.png",
      "/_build/assets/hero.mp4",
      "/download/stable/darwin-aarch64-dmg",
      "/files/site/2026-11/product-videos/heroes/sdk-landscape-dark.mp4",
    ])
      expect(mediaRedirect(path, "")).toBeUndefined()
  })
})
