import { describe, expect, test } from "bun:test"
import { mediaBase, mediaUrl } from "../src/lib/media"

describe("media in the files bucket", () => {
  test("puts heavy media under the files route at the same path", () => {
    expect(mediaBase).toBe("/files/site/2026-11")
    expect(mediaUrl("/product-videos/heroes/sdk-landscape-dark.mp4")).toBe(
      "/files/site/2026-11/product-videos/heroes/sdk-landscape-dark.mp4",
    )
    expect(mediaUrl("/arcade3d/cabinet.glb")).toBe("/files/site/2026-11/arcade3d/cabinet.glb")
  })

  test("leaves pages, images, external URLs and already-mapped paths alone", () => {
    for (const path of [
      "/",
      "/product",
      "/brand/files/opencode-logo-dark.png",
      "https://github.com/user-attachments/assets/clip.mp4",
      "/files/site/2026-11/arcade3d/cabinet.glb",
    ])
      expect(mediaUrl(path)).toBe(path)
  })
})
