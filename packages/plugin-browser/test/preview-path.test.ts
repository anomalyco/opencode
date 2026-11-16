import { expect, test } from "bun:test"
import { previewPath } from "../src/preview-path.js"

test("the disk owner, not the desktop OS, decides which relative names are valid", () => {
  for (const path of ["src/aux.html", "icons/CON.svg", "12:00.png", "trailing."]) {
    expect(previewPath(path, false)).toBe(true)
    expect(previewPath(path, true)).toBe(false)
  }
  for (const path of ["a/../x", "C:/foo", "/a", "a//b", "a\\b", "a\0b"]) {
    expect(previewPath(path, false)).toBe(false)
    expect(previewPath(path, true)).toBe(false)
  }
})
