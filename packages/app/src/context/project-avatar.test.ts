import { describe, expect, test } from "bun:test"
import { pickProjectIcon } from "./project-avatar"

describe("pickProjectIcon", () => {
  test("prefers child icon over metadata", () => {
    const icon = pickProjectIcon({
      child: "child-icon",
      meta: { url: "root-url", override: "root-override" },
    })

    expect(icon.url).toBe("child-icon")
    expect(icon.override).toBe("child-icon")
  })

  test("falls back to metadata url then override", () => {
    const fromUrl = pickProjectIcon({
      meta: { url: "root-url", override: "root-override" },
    })
    const fromOverride = pickProjectIcon({
      meta: { override: "root-override" },
    })

    expect(fromUrl.url).toBe("root-url")
    expect(fromUrl.override).toBe("root-override")
    expect(fromOverride.url).toBe("root-override")
    expect(fromOverride.override).toBe("root-override")
  })
})
