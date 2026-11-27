import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { FSUtil } from "../src/fs-util.js"

describe("FSUtil.fileUrlPath", () => {
  test("decodes a file URL to a path", () => {
    const file = path.resolve("a b.txt")
    expect(FSUtil.fileUrlPath(pathToFileURL(file))).toBe(file)
  })

  // Older clients send a UNC path as file:////server/share. Bun decodes that to \server\share on the current drive.
  test.skipIf(process.platform !== "win32")("reads the four-slash UNC form on Windows", () => {
    expect(FSUtil.fileUrlPath(new URL("file:////wsl.localhost/Ubuntu/home/a%20b.txt"))).toBe(
      "\\\\wsl.localhost\\Ubuntu\\home\\a b.txt",
    )
    expect(FSUtil.fileUrlPath(new URL("file://wsl.localhost/Ubuntu/home/a%20b.txt"))).toBe(
      "\\\\wsl.localhost\\Ubuntu\\home\\a b.txt",
    )
  })
})

describe("FSUtil.expandHome", () => {
  const home = path.resolve("home-dir")

  test("expands ~ and ~/ on every platform", () => {
    expect(FSUtil.expandHome("~", home)).toBe(home)
    expect(FSUtil.expandHome("~/notes/a.md", home)).toBe(path.join(home, "notes", "a.md"))
  })

  test("expands ~\\ only on Windows, where it is a home path", () => {
    expect(FSUtil.expandHome("~\\notes\\a.md", home)).toBe(
      process.platform === "win32" ? path.join(home, "notes", "a.md") : "~\\notes\\a.md",
    )
  })

  test("leaves other text unchanged", () => {
    for (const input of ["~user/a", "~+/a", "a/~/b", "./~", "/abs/path", ""])
      expect(FSUtil.expandHome(input, home)).toBe(input)
  })

  test("joins with the home's own path rules", () => {
    expect(FSUtil.expandHome("~/p/**", "C:\\Users\\test")).toBe("C:\\Users\\test\\p\\**")
    expect(FSUtil.expandHome("~/p/**", "/home/test")).toBe("/home/test/p/**")
  })
})
