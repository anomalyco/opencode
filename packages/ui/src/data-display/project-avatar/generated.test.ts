import { createHash } from "crypto"
import { describe, expect, test } from "bun:test"
import { generateProjectIcon, getProjectAvatarGenerated } from "./project-avatar"

describe("generateProjectIcon", () => {
  test("derives the same icon from the same key", () => {
    expect(generateProjectIcon("project-a")).toEqual(generateProjectIcon("project-a"))
    expect(generateProjectIcon("project-a")).not.toEqual(generateProjectIcon("project-b"))
  })

  // Projects without a stored icon fall back to this output, so it must not drift between releases.
  test("resolves the seed, palette and every drawing parameter", () => {
    expect(generateProjectIcon("9f1c2a7e01")).toEqual({
      style: "mesh",
      version: 1,
      params: {
        scale: 0.95,
        fold: 0.4,
        light: 1,
        tilt: -0.02,
        speed: 0.9,
        grain: 0.14,
        grainSize: 16,
        seedX: 39.46408212184906,
        seedY: 35.76026787981391,
        grainX: 60,
        grainY: 31,
        color0: 0x10451d,
        color1: 0x4c956c,
        color2: 0xd68c45,
        color3: 0xf2e8cf,
      },
    })
  })
})

describe("getProjectAvatarGenerated", () => {
  test("keeps chosen and discovered icons", () => {
    expect(getProjectAvatarGenerated({ id: "abc", icon: { override: "data:custom" } })).toBeUndefined()
    expect(getProjectAvatarGenerated({ id: "abc", icon: { url: "data:auto" } })).toBeUndefined()
    expect(getProjectAvatarGenerated({ id: "abc", icon: { color: "blue" } })).toBeUndefined()
    const opencode = createHash("sha1").update("git-remote:github.com/anomalyco/opencode").digest("hex")
    expect(getProjectAvatarGenerated({ id: opencode, worktree: "/repo" })).toBeUndefined()
  })

  test("seeds by project ID or, for unidentified projects, by directory", () => {
    expect(getProjectAvatarGenerated({ id: "abc", worktree: "/repo" })).toBe("abc")
    expect(getProjectAvatarGenerated({ id: "global", worktree: "/scratch" })).toBe("/scratch")
  })
})
