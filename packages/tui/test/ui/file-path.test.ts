import { describe, expect, test } from "bun:test"
import { truncateFilePath } from "../../src/ui/file-path"

describe("truncateFilePath", () => {
  const path = "packages/tui/src/ui/dialog-select.tsx"

  test("keeps the full path when it fits", () => {
    expect(truncateFilePath(path, 37)).toBe(path)
  })

  test("adds nearest parent segments from right to left", () => {
    expect(truncateFilePath(path, 26)).toBe("…/src/ui/dialog-select.tsx")
    expect(truncateFilePath(path, 22)).toBe("…/ui/dialog-select.tsx")
    expect(truncateFilePath(path, 19)).toBe("…/dialog-select.tsx")
  })

  test("preserves the extension when the basename must shrink", () => {
    expect(truncateFilePath(path, 16)).toBe("…/dialog-se….tsx")
    expect(truncateFilePath("dialog-select.tsx", 12)).toBe("dialog-….tsx")
  })

  test("preserves the input separator", () => {
    expect(truncateFilePath("packages\\tui\\src\\ui\\dialog-select.tsx", 22)).toBe("…\\ui\\dialog-select.tsx")
  })

  test("does not treat a backslash in a POSIX filename as a separator", () => {
    expect(truncateFilePath("dir/file\\name.ts", 14)).toBe("…/file\\name.ts")
  })

  test("preserves absolute roots", () => {
    expect(truncateFilePath("/file.ts", 7)).toBe("/fi….ts")
    expect(truncateFilePath("C:\\file.ts", 9)).toBe("C:\\fi….ts")
    expect(truncateFilePath("/usr/local/bin/file.ts", 14)).toBe("/…/bin/file.ts")
    expect(truncateFilePath("C:\\Users\\kit\\src\\file.ts", 16)).toBe("C:\\…\\src\\file.ts")
    expect(truncateFilePath("C:/Users/kit/src/file.ts", 16)).toBe("C:/…/src/file.ts")
    expect(truncateFilePath("C:\\Users\\kit/src/file.ts", 16)).toBe("C:\\…\\src\\file.ts")
    expect(truncateFilePath("\\\\server\\share\\src\\file.ts", 25)).toBe("\\\\server\\share\\…\\file.ts")
  })

  test("measures terminal columns without splitting graphemes", () => {
    expect(truncateFilePath("packages/组件/对话框.tsx", 12)).toBe("…/对话框.tsx")
    expect(truncateFilePath("src/👩‍💻-notes.tsx", 12)).toContain("👩‍💻")
    expect(truncateFilePath("中a.txt", 6)).toBe("….txt")
    expect(truncateFilePath("file.中a", 3)).toBe("…a")
  })

  test("never exceeds the requested width", () => {
    for (let width = 0; width <= Bun.stringWidth(path); width++) {
      expect(Bun.stringWidth(truncateFilePath(path, width))).toBeLessThanOrEqual(width)
    }
  })
})
