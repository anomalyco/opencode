import { describe, expect, test } from "bun:test"
import { attachmentMime } from "./files"
import { pasteMode } from "./paste"
import { parseMultiPathDropPaths } from "./multi-path-drop"

describe("attachmentMime", () => {
  test("keeps PDFs when the browser reports the mime", async () => {
    const file = new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" })
    expect(await attachmentMime(file)).toBe("application/pdf")
  })

  test("normalizes structured text types to text/plain", async () => {
    const file = new File(['{"ok":true}\n'], "data.json", { type: "application/json" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("accepts text files even with a misleading browser mime", async () => {
    const file = new File(["export const x = 1\n"], "main.ts", { type: "video/mp2t" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("rejects binary files", async () => {
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "blob.bin", { type: "application/octet-stream" })
    expect(await attachmentMime(file)).toBeUndefined()
  })
})

// FORK: 多选拖动从 file-tree 到聊天 — 测试 abs path JSON → rel path 转换 [feat: file-tree-multi-drag-to-chat] 2026-05-15
describe("parseMultiPathDropPaths", () => {
  const root = "D:/project/notes"

  test("empty / null / undefined input → []", () => {
    expect(parseMultiPathDropPaths(null, root)).toEqual([])
    expect(parseMultiPathDropPaths(undefined, root)).toEqual([])
    expect(parseMultiPathDropPaths("", root)).toEqual([])
  })

  test("invalid JSON → []", () => {
    expect(parseMultiPathDropPaths("not json", root)).toEqual([])
    expect(parseMultiPathDropPaths("{broken", root)).toEqual([])
  })

  test("non-array JSON → []", () => {
    expect(parseMultiPathDropPaths('{"a":1}', root)).toEqual([])
    expect(parseMultiPathDropPaths('"single string"', root)).toEqual([])
  })

  test("converts abs paths under root to relative (forward slash)", () => {
    const json = JSON.stringify(["D:/project/notes/a.md", "D:/project/notes/sub/b.md"])
    expect(parseMultiPathDropPaths(json, root)).toEqual(["a.md", "sub/b.md"])
  })

  test("normalizes Windows backslash in abs paths", () => {
    const json = JSON.stringify(["D:\\project\\notes\\a.md", "D:\\project\\notes\\sub\\b.md"])
    expect(parseMultiPathDropPaths(json, root)).toEqual(["a.md", "sub/b.md"])
  })

  test("handles root with trailing slash", () => {
    const json = JSON.stringify(["D:/project/notes/a.md"])
    expect(parseMultiPathDropPaths(json, "D:/project/notes/")).toEqual(["a.md"])
  })

  test("abs path not under root → fallback original path (forward slash normalized)", () => {
    const json = JSON.stringify(["E:/elsewhere/x.md", "D:\\other\\y.md"])
    expect(parseMultiPathDropPaths(json, root)).toEqual(["E:/elsewhere/x.md", "D:/other/y.md"])
  })

  test("missing root → returns all paths normalized to forward slash", () => {
    const json = JSON.stringify(["D:\\project\\notes\\a.md"])
    expect(parseMultiPathDropPaths(json, undefined)).toEqual(["D:/project/notes/a.md"])
  })

  test("non-string entries filtered out", () => {
    const json = JSON.stringify(["D:/project/notes/a.md", null, 42, "", "D:/project/notes/b.md"])
    expect(parseMultiPathDropPaths(json, root)).toEqual(["a.md", "b.md"])
  })

  test("abs path equal to root → empty string (project root)", () => {
    const json = JSON.stringify(["D:/project/notes"])
    expect(parseMultiPathDropPaths(json, root)).toEqual([""])
  })
})

describe("pasteMode", () => {
  test("uses native paste for short single-line text", () => {
    expect(pasteMode("hello world")).toBe("native")
  })

  test("uses manual paste for multiline text", () => {
    expect(
      pasteMode(`{
  "ok": true
}`),
    ).toBe("manual")
    expect(pasteMode("a\r\nb")).toBe("manual")
  })

  test("uses manual paste for large text", () => {
    expect(pasteMode("x".repeat(8000))).toBe("manual")
  })
})
