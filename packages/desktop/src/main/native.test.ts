import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveDesktopPath } from "./native-path"

describe("native desktop paths", () => {
  test("expands home aliases before resolving paths", () => {
    expect(resolveDesktopPath("~")).toBe(resolve(homedir()))
    expect(resolveDesktopPath("~/")).toBe(resolve(homedir()))
    expect(resolveDesktopPath("~/Documents")).toBe(resolve(homedir(), "Documents"))
    expect(resolveDesktopPath("~\\Documents")).toBe(resolve(homedir(), "Documents"))
  })

  test("leaves normal paths on the standard resolver path", () => {
    expect(resolveDesktopPath("/tmp/example")).toBe(resolve("/tmp/example"))
    expect(resolveDesktopPath("relative/example")).toBe(resolve("relative/example"))
    expect(resolveDesktopPath(join("/tmp", "space dir"))).toBe(resolve("/tmp", "space dir"))
  })
})
