import { expect, test } from "bun:test"
import { resolveStartDirectory } from "./start-directory"

const windows = {
  platform: "win32" as const,
  systemRoot: "C:\\Windows",
  home: "C:\\Users\\alice",
}

test("uses the home directory when Windows starts the process in System32", () => {
  expect(resolveStartDirectory("C:\\Windows\\System32", windows)).toBe("C:\\Users\\alice")
})

test("matches the system directories without regard to case or trailing separators", () => {
  expect(resolveStartDirectory("c:\\windows\\system32\\", windows)).toBe("C:\\Users\\alice")
  expect(resolveStartDirectory("C:\\Windows\\SysWOW64", windows)).toBe("C:\\Users\\alice")
})

test("keeps a regular directory", () => {
  expect(resolveStartDirectory("C:\\Users\\alice\\project", windows)).toBe("C:\\Users\\alice\\project")
})

test("does not rewrite directories on other platforms", () => {
  expect(resolveStartDirectory("/root/System32", { ...windows, platform: "linux" })).toBe("/root/System32")
})

test("keeps the launch directory on another drive", () => {
  expect(resolveStartDirectory("D:\\Windows\\System32", windows)).toBe("D:\\Windows\\System32")
})
