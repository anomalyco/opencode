import { expect, test } from "bun:test"
import { formatPath } from "../../src/util/path-format"

test("formats relative, home, and foreign paths", () => {
  expect(formatPath(".", { base: "/work/project" })).toBe(".")
  expect(formatPath("../shared/a.ts", { base: "/work/project" })).toBe("/work/shared/a.ts")
  expect(formatPath("/home/test/project", { base: "/work", home: "/home/test" })).toBe("~/project")
  expect(formatPath("src\\a.ts", { base: "/work", forwardSlashes: true })).toBe("src/a.ts")
  expect(formatPath("C:/", { base: "/work" })).toBe("C:/")
  expect(formatPath("C:\\Users\\tester", { base: "/work", forwardSlashes: true })).toBe("C:/Users/tester")
  expect(formatPath("..\\shared\\a.ts", { base: "C:\\work\\project", forwardSlashes: true })).toBe(
    "C:/work/shared/a.ts",
  )
  expect(
    formatPath("C:\\Users\\test\\project", { base: "C:\\work", home: "C:\\Users\\test" }),
  ).toBe("~/project")
})
