import { describe, expect, test } from "bun:test"
import { absolutePathHref, desktopAllowedUriRegexp } from "./markdown-desktop"

describe("absolutePathHref", () => {
  test("converts unix absolute paths", () => {
    expect(absolutePathHref("/Users/me/project/file.md")).toBe("file:///Users/me/project/file.md")
    expect(absolutePathHref("`/tmp/x`")).toBeUndefined()
  })

  test("converts windows absolute paths", () => {
    expect(absolutePathHref("C:\\Users\\me\\file.md")).toBe("file:///C:/Users/me/file.md")
    expect(absolutePathHref("D:/repo/app.ts")).toBe("file:///D:/repo/app.ts")
  })

  test("passes through file URLs", () => {
    expect(absolutePathHref("file:///tmp/opencode")).toBe("file:///tmp/opencode")
  })

  test("strips trailing punctuation and line numbers", () => {
    expect(absolutePathHref("/Users/me/app.ts.")).toBe("file:///Users/me/app.ts")
    expect(absolutePathHref("/Users/me/app.ts:12")).toBe("file:///Users/me/app.ts")
    expect(absolutePathHref("/Users/me/app.ts:12:4")).toBe("file:///Users/me/app.ts")
  })

  test("rejects relative paths and web urls", () => {
    expect(absolutePathHref("src/app.ts")).toBeUndefined()
    expect(absolutePathHref("https://opencode.ai")).toBeUndefined()
    expect(absolutePathHref("/")).toBeUndefined()
  })
})

describe("desktopAllowedUriRegexp", () => {
  test("allows file and web schemes", () => {
    expect(desktopAllowedUriRegexp.test("file:///tmp/x")).toBe(true)
    expect(desktopAllowedUriRegexp.test("https://opencode.ai")).toBe(true)
    expect(desktopAllowedUriRegexp.test("http://localhost")).toBe(true)
  })
})
