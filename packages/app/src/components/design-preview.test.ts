import { describe, expect, test } from "bun:test"
import { pickClasses } from "./design-preview/pick-classes"

describe("pickClasses", () => {
  test("prefers specific classes over utility tokens", () => {
    expect(pickClasses("flex items-center rounded-md hero-card settings-panel")).toEqual([
      "settings-panel",
      "hero-card",
    ])
  })

  test("strips variants before filtering utilities", () => {
    expect(pickClasses("md:flex dark:bg-black lg:rounded-xl md:project-shell xl:nav-item")).toEqual([
      "project-shell",
      "nav-item",
    ])
  })
})
