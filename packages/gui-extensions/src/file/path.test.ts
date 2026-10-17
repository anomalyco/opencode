import { describe, expect, test } from "bun:test"
import { openInAppParentPath, resolveOpenInAppPath, workspaceFileUrl } from "./path"

describe("workspaceFileUrl", () => {
  test("keeps the host for UNC roots", () => {
    expect(workspaceFileUrl("\\\\server\\share\\proj", "src/a.ts")).toBe("file://server/share/proj/src/a.ts")
    expect(workspaceFileUrl("//server/share/proj", "src/a.ts")).toBe("file://server/share/proj/src/a.ts")
  })

  test("keeps previous output for posix and drive roots", () => {
    expect(workspaceFileUrl("/repo", "src/a.ts")).toBe("file:///repo/src/a.ts")
    expect(workspaceFileUrl("C:\\repo", "src\\a.ts")).toBe("file:///C:/repo/src/a.ts")
  })
})

describe("resolveOpenInAppPath", () => {
  test("joins relative paths using the workspace separator", () => {
    expect(resolveOpenInAppPath("/workspace/project", "src/file.ts")).toBe("/workspace/project/src/file.ts")
    expect(resolveOpenInAppPath("C:\\workspace\\project", "src/file.ts")).toBe("C:\\workspace\\project\\src\\file.ts")
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
