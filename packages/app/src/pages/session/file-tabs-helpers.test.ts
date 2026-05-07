// FORK: file-tabs.tsx 纯 helper 测试 — D2 关键模块清单第 4 个文件 2026-05-07
//
// file-tabs.tsx ~1668 行,绝大部分是 SolidJS 组件 + JSX + state(右键菜单 / 选区
// 历史栈 / 编辑态等)。本笔走 helper extract 路径(同 D1)— 把文件顶部的 8 个纯
// helper 加 export 单独测,组件本体行覆盖率仍 0(JSX + reactive state 通过 e2e
// 间接覆盖更合适)。
//
// 测试 import 整个 file-tabs.tsx 模块需要确认不会触发组件渲染 — module 顶部
// 都是 type / const / function,不会执行 SolidJS hook。

import { describe, expect, test } from "bun:test"
import {
  isMarkdownPath,
  isHtmlPath,
  pathDirname,
  isUnsupportedMedia,
  mediaKindFromPath,
  rangeAt,
  normalizeWithMap,
  findLineRange,
  truncatePreview,
} from "./file-tabs-helpers"

describe("isMarkdownPath", () => {
  test(".md / .markdown 都识别(大小写无关)", () => {
    expect(isMarkdownPath("a.md")).toBe(true)
    expect(isMarkdownPath("a.MD")).toBe(true)
    expect(isMarkdownPath("a.markdown")).toBe(true)
    expect(isMarkdownPath("a.MARKDOWN")).toBe(true)
  })

  test("非 .md 扩展返 false", () => {
    expect(isMarkdownPath("a.html")).toBe(false)
    expect(isMarkdownPath("a.txt")).toBe(false)
    expect(isMarkdownPath("noext")).toBe(false)
  })

  test("undefined / 空 → false", () => {
    expect(isMarkdownPath(undefined)).toBe(false)
    expect(isMarkdownPath("")).toBe(false)
  })

  test("带路径前缀也能识别", () => {
    expect(isMarkdownPath("docs/intro.md")).toBe(true)
    expect(isMarkdownPath("C:\\Users\\x\\note.MARKDOWN")).toBe(true)
  })
})

describe("isHtmlPath", () => {
  test(".html / .htm 识别(大小写无关)", () => {
    expect(isHtmlPath("a.html")).toBe(true)
    expect(isHtmlPath("a.HTML")).toBe(true)
    expect(isHtmlPath("a.htm")).toBe(true)
    expect(isHtmlPath("a.HTM")).toBe(true)
  })

  test("非 HTML 扩展返 false", () => {
    expect(isHtmlPath("a.md")).toBe(false)
    expect(isHtmlPath("a.xml")).toBe(false)
  })

  test("undefined / 空 → false", () => {
    expect(isHtmlPath(undefined)).toBe(false)
    expect(isHtmlPath("")).toBe(false)
  })
})

describe("pathDirname(POSIX-style 父目录)", () => {
  test("forward slash 路径", () => {
    expect(pathDirname("a/b/c.md")).toBe("a/b")
    expect(pathDirname("docs/intro.md")).toBe("docs")
  })

  test("Windows 反斜杠路径(转 forward)", () => {
    expect(pathDirname("a\\b\\c.md")).toBe("a/b")
    expect(pathDirname("C:\\Users\\x\\file.txt")).toBe("C:/Users/x")
  })

  test("根目录文件 → 空字符串", () => {
    expect(pathDirname("file.md")).toBe("")
    expect(pathDirname("noext")).toBe("")
  })

  test("绝对 Unix 路径", () => {
    expect(pathDirname("/usr/local/bin/x")).toBe("/usr/local/bin")
  })

  test("混合分隔符", () => {
    expect(pathDirname("a/b\\c.md")).toBe("a/b")
  })

  test("末尾 / 视为目录(返父目录)", () => {
    expect(pathDirname("a/b/")).toBe("a/b")
  })
})

describe("isUnsupportedMedia(WebView2 解不出的扩展兜底)", () => {
  test(".m4a 是不支持的(WebView2 解不出)", () => {
    expect(isUnsupportedMedia("song.m4a")).toBe(true)
    expect(isUnsupportedMedia("song.M4A")).toBe(true)
  })

  test(".mp3 / .mp4 / .wav 是支持的", () => {
    expect(isUnsupportedMedia("song.mp3")).toBe(false)
    expect(isUnsupportedMedia("video.mp4")).toBe(false)
    expect(isUnsupportedMedia("a.wav")).toBe(false)
  })

  test("undefined / 空 → false", () => {
    expect(isUnsupportedMedia(undefined)).toBe(false)
    expect(isUnsupportedMedia("")).toBe(false)
  })
})

describe("mediaKindFromPath", () => {
  test("video 扩展返 video kind + mimes", () => {
    const m = mediaKindFromPath("v.mp4")
    expect(m?.kind).toBe("video")
    expect(m?.mimes).toContain("video/mp4")
  })

  test(".mov 含多个 mime fallback(quicktime + mp4)", () => {
    const m = mediaKindFromPath("a.mov")
    expect(m?.kind).toBe("video")
    expect(m?.mimes).toEqual(expect.arrayContaining(["video/quicktime", "video/mp4"]))
  })

  test("audio 扩展返 audio kind + mimes", () => {
    const m = mediaKindFromPath("a.mp3")
    expect(m?.kind).toBe("audio")
    expect(m?.mimes).toContain("audio/mpeg")
  })

  test(".m4a 多 mime fallback(audio/mp4 + x-m4a + aac)", () => {
    const m = mediaKindFromPath("a.m4a")
    expect(m?.kind).toBe("audio")
    expect(m?.mimes.length).toBeGreaterThanOrEqual(3)
  })

  test("非媒体扩展返 null", () => {
    expect(mediaKindFromPath("a.md")).toBeNull()
    expect(mediaKindFromPath("a.txt")).toBeNull()
    expect(mediaKindFromPath("noext")).toBeNull()
  })

  test("undefined / 空 → null", () => {
    expect(mediaKindFromPath(undefined)).toBeNull()
    expect(mediaKindFromPath("")).toBeNull()
  })

  test("大小写无关", () => {
    expect(mediaKindFromPath("A.MP4")?.kind).toBe("video")
    expect(mediaKindFromPath("A.WAV")?.kind).toBe("audio")
  })
})

describe("rangeAt(算 1-based 行号区间)", () => {
  test("单行内的 offset", () => {
    const r = rangeAt("hello world", 0, 5) // "hello"
    expect(r).toEqual({ start: 1, end: 1 })
  })

  test("跨行 offset", () => {
    // line1\nline2\nline3
    // 0:l 1:i 2:n 3:e 4:1 5:\n 6:l 7:i 8:n 9:e 10:2 11:\n
    const src = "line1\nline2\nline3"
    const r = rangeAt(src, 6, 5) // "line2"
    expect(r).toEqual({ start: 2, end: 2 })
  })

  test("跨多行 inner", () => {
    const src = "line1\nline2\nline3"
    const r = rangeAt(src, 0, 11) // "line1\nline2"
    expect(r).toEqual({ start: 1, end: 2 })
  })

  test("offset 0 + len 0 → 起始行 1, end 1", () => {
    expect(rangeAt("hello", 0, 0)).toEqual({ start: 1, end: 1 })
  })
})

describe("normalizeWithMap(空白归一化 + offset 映射)", () => {
  test("无空白文字不变", () => {
    const r = normalizeWithMap("hello")
    expect(r.text).toBe("hello")
    expect(r.back).toEqual([0, 1, 2, 3, 4])
  })

  test("多个空格压缩为单个", () => {
    const r = normalizeWithMap("a   b")
    expect(r.text).toBe("a b")
  })

  test("混合 \\t \\n \\r 都视为单空格", () => {
    const r = normalizeWithMap("a\t\nb")
    expect(r.text).toBe("a b")
  })

  test("行首空白被吃掉(out 还为空时不加 space)", () => {
    const r = normalizeWithMap("   leading")
    expect(r.text).toBe("leading")
  })
})

describe("findLineRange(在 source 里找 needle 的行号区间)", () => {
  test("精确匹配单行", () => {
    const src = "line1\nline2\nline3"
    expect(findLineRange(src, "line2")).toEqual({ start: 2, end: 2 })
  })

  test("精确匹配多行 needle", () => {
    const src = "line1\nline2\nline3"
    expect(findLineRange(src, "line1\nline2")).toEqual({ start: 1, end: 2 })
  })

  test("空 source / 空 needle → null", () => {
    expect(findLineRange("", "x")).toBeNull()
    expect(findLineRange("abc", "")).toBeNull()
  })

  test("trim needle 空白后匹配", () => {
    const src = "hello world"
    expect(findLineRange(src, "  hello  ")?.start).toBe(1)
  })

  test("找不到 → null", () => {
    expect(findLineRange("abc", "xyz")).toBeNull()
  })

  test("归一化空白后能匹配(跨多个空格)", () => {
    // source 有原始空白,needle 是单空格 — 经归一化后能找到
    const src = "abc   def\n   ghi"
    const r = findLineRange(src, "abc def")
    expect(r).not.toBeNull()
  })
})

describe("truncatePreview(空白压缩 + 长度截断)", () => {
  test("短文本不截断", () => {
    expect(truncatePreview("hello")).toBe("hello")
  })

  test("空白压缩(\\n / \\t / 多空格 → 单空格)", () => {
    expect(truncatePreview("a\n\nb\t\tc")).toBe("a b c")
    expect(truncatePreview("a   b")).toBe("a b")
  })

  test("超长截断 + 加 …", () => {
    const long = "x".repeat(600)
    const out = truncatePreview(long)
    expect(out.length).toBe(501) // 500 + …
    expect(out.endsWith("…")).toBe(true)
  })

  test("自定义 max 参数", () => {
    expect(truncatePreview("abcdef", 3)).toBe("abc…")
  })

  test("trim 前后空白", () => {
    expect(truncatePreview("   hello   ")).toBe("hello")
  })

  test("空字符串", () => {
    expect(truncatePreview("")).toBe("")
  })
})
