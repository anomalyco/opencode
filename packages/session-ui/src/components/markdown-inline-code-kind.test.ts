import { describe, expect, test } from "bun:test"
import { inlineCodeKind } from "./markdown-inline-code-kind"

describe("inlineCodeKind", () => {
  test.each([
    "app.tsx",
    "app.tsx:42",
    "app.tsx#L42-L55",
    "src/file.ts",
    "C:\\tmp\\out.html",
    "/etc/hosts",
    "app/(auth)/[id]/page.tsx",
    "console.log",
    "Dockerfile",
    "Makefile:12",
    "my docs/notes.md",
    "C:\\Program Files\\app\\file.txt",
  ])("treats %s as a possible path", (text) => {
    expect(inlineCodeKind(text)).toBe("path")
  })

  test.each([
    "value",
    "readme",
    "1.2.3",
    "127.0.0.1:8080",
    "foo(bar)",
    "a = b",
    "<App />",
    "src/**/*.ts",
    "{ a: 1 }",
    "...",
    "ftp://x/y",
    "\\\\host\\share\\x.ts",
    "//host/share/x.ts",
    "bun test src/file",
    "cd packages/app",
    "npm 10.2.0",
  ])("leaves %s as code", (text) => {
    expect(inlineCodeKind(text)).toBeUndefined()
  })

  test("detects http urls", () => {
    expect(inlineCodeKind("https://opencode.ai/docs")).toBe("url")
  })
})
