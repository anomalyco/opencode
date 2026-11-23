import { expect, test } from "bun:test"
import { previewPath, remotePath, workspacePrefix } from "../src/preview-path.js"

test("a workspace address names its session in any case", () => {
  const prefix = workspacePrefix("ses_AbC123")

  for (const address of ["workspace://ses_abc123/site/page.html", "workspace://ses_AbC123/site/page.html", "WORKSPACE://SES_ABC123/site/page.html"])
    expect(remotePath(address, prefix)).toBe("site/page.html")
  // Another session's address names nothing here, and the path keeps its own case.
  expect(remotePath("workspace://ses_other/site/page.html", prefix)).toBeUndefined()
  expect(remotePath("workspace://ses_abc123/Site/Page.html", prefix)).toBe("Site/Page.html")
})

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
