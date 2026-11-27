import { describe, expect, test } from "bun:test"
import path from "path"
import { FSUtil } from "../src/fs-util.js"

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
