import { describe, expect, test } from "bun:test"
import { openInAppParentPath, resolveOpenInAppPath } from "./open-in-app-path"

describe("resolveOpenInAppPath", () => {
  test("joins relative paths using the workspace separator", () => {
    expect(resolveOpenInAppPath("/workspace/project", "src/file.ts")).toBe("/workspace/project/src/file.ts")
    expect(resolveOpenInAppPath("C:\\workspace\\project", "src/file.ts")).toBe("C:\\workspace\\project\\src\\file.ts")
  })

  test("does not duplicate root separators", () => {
    expect(resolveOpenInAppPath("/workspace/project/", "src/file.ts")).toBe("/workspace/project/src/file.ts")
    expect(resolveOpenInAppPath("C:/workspace/project/", "src\\file.ts")).toBe("C:/workspace/project/src/file.ts")
  })

  test("preserves backslashes in POSIX filenames", () => {
    expect(resolveOpenInAppPath("/workspace", "src\\file.ts")).toBe("/workspace/src\\file.ts")
    expect(resolveOpenInAppPath("/workspace", "\\file.ts")).toBe("/workspace/\\file.ts")
  })

  test("preserves absolute POSIX, Windows, and UNC paths", () => {
    expect(resolveOpenInAppPath("/workspace", "/tmp/file.ts")).toBe("/tmp/file.ts")
    expect(resolveOpenInAppPath("C:/workspace", "D:\\src\\file.ts")).toBe("D:\\src\\file.ts")
    expect(resolveOpenInAppPath("C:/workspace", "\\\\server\\share\\file.ts")).toBe("\\\\server\\share\\file.ts")
    expect(resolveOpenInAppPath("C:/workspace", "\\src\\file.ts")).toBe("\\src\\file.ts")
  })
})

describe("openInAppParentPath", () => {
  test("preserves POSIX and Windows roots", () => {
    expect(openInAppParentPath("/file.ts")).toBe("/")
    expect(openInAppParentPath("/workspace/file.ts")).toBe("/workspace")
    expect(openInAppParentPath("C:\\file.ts")).toBe("C:\\")
    expect(openInAppParentPath("C:\\workspace\\file.ts")).toBe("C:\\workspace")
    expect(openInAppParentPath("\\\\server\\share\\file.ts")).toBe("\\\\server\\share")
  })
})
