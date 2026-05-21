// FORK: 大文件预览统一防护 helper 单测
// [feat: large-file-preview-guard] 2026-05-21
//
// pure helper(无 SolidJS context 依赖),单测覆盖 ext 分类 + 阈值判断 + size 格式化

import { describe, expect, test } from "bun:test"
import { categoryOf, limitFor, tooLargeFor, formatSize, SIZE_LIMITS } from "./file-size-guard"

const MB = 1024 * 1024

describe("categoryOf", () => {
  test("markdown 优先(放在 media 前)", () => {
    expect(categoryOf("README.md")).toBe("markdown")
    expect(categoryOf("path/to/notes.markdown")).toBe("markdown")
    expect(categoryOf("UPPERCASE.MD")).toBe("markdown")
  })

  test("media:视频 / 音频 / 图片", () => {
    expect(categoryOf("video.mp4")).toBe("media")
    expect(categoryOf("clip.webm")).toBe("media")
    expect(categoryOf("song.mp3")).toBe("media")
    expect(categoryOf("audio.m4a")).toBe("media")
    expect(categoryOf("photo.png")).toBe("media")
    expect(categoryOf("photo.JPG")).toBe("media")
    expect(categoryOf("anim.gif")).toBe("media")
    expect(categoryOf("modern.webp")).toBe("media")
  })

  test("html", () => {
    expect(categoryOf("index.html")).toBe("html")
    expect(categoryOf("page.htm")).toBe("html")
  })

  test("office", () => {
    expect(categoryOf("doc.docx")).toBe("office")
    expect(categoryOf("sheet.xlsx")).toBe("office")
    expect(categoryOf("slides.pptx")).toBe("office")
  })

  test("binary(可执行 / 归档 / 字体)", () => {
    expect(categoryOf("app.exe")).toBe("binary")
    expect(categoryOf("archive.zip")).toBe("binary")
    expect(categoryOf("font.woff2")).toBe("binary")
  })

  test("text 兜底(代码 / 配置 / 未识别扩展)", () => {
    expect(categoryOf("main.ts")).toBe("text")
    expect(categoryOf("config.json")).toBe("text")
    expect(categoryOf("script.py")).toBe("text")
    expect(categoryOf("Makefile")).toBe("text")
    expect(categoryOf("README")).toBe("text")
  })

  test("空 / undefined → default", () => {
    expect(categoryOf(undefined)).toBe("default")
    expect(categoryOf("")).toBe("default")
  })
})

describe("limitFor + tooLargeFor", () => {
  test("text/code 10MB 阈值", () => {
    expect(limitFor("main.ts")).toBe(10 * MB)
    expect(tooLargeFor("main.ts", 5 * MB)).toBe(false)
    expect(tooLargeFor("main.ts", 10 * MB)).toBe(false) // 等于阈值不算超
    expect(tooLargeFor("main.ts", 10 * MB + 1)).toBe(true)
    expect(tooLargeFor("main.ts", 50 * MB)).toBe(true)
  })

  test("markdown 10MB 阈值", () => {
    expect(limitFor("readme.md")).toBe(10 * MB)
    expect(tooLargeFor("readme.md", 5 * MB)).toBe(false)
    expect(tooLargeFor("readme.md", 20 * MB)).toBe(true)
  })

  test("media 无阈值(走 localasset 分片读)", () => {
    expect(limitFor("video.mp4")).toBe(Number.POSITIVE_INFINITY)
    expect(tooLargeFor("video.mp4", 5 * 1024 * MB)).toBe(false) // 5GB 也不超
  })

  test("binary 无阈值(backend 返空 content,N/A)", () => {
    expect(limitFor("archive.zip")).toBe(Number.POSITIVE_INFINITY)
    expect(tooLargeFor("archive.zip", 10 * 1024 * MB)).toBe(false)
  })

  test("office 200MB 阈值(2026-05-21 user 决议 50MB→200MB,覆盖含图/含视频 PPT)", () => {
    expect(limitFor("doc.docx")).toBe(200 * MB)
    expect(tooLargeFor("doc.docx", 150 * MB)).toBe(false)
    expect(tooLargeFor("doc.docx", 100 * MB)).toBe(false)
    expect(tooLargeFor("doc.docx", 250 * MB)).toBe(true)
    expect(tooLargeFor("slides.pptx", 199 * MB)).toBe(false)
    expect(tooLargeFor("slides.pptx", 201 * MB)).toBe(true)
  })

  test("html 10MB 阈值(对齐 HTML_PREVIEW_MAX_BYTES)", () => {
    expect(limitFor("page.html")).toBe(10 * MB)
    expect(tooLargeFor("page.html", 20 * MB)).toBe(true)
  })

  test("default 100MB 阈值", () => {
    expect(limitFor(undefined)).toBe(100 * MB)
    expect(tooLargeFor(undefined, 50 * MB)).toBe(false)
    expect(tooLargeFor(undefined, 200 * MB)).toBe(true)
  })
})

describe("formatSize", () => {
  test("bytes < 1KB → B", () => {
    expect(formatSize(0)).toBe("0 B")
    expect(formatSize(512)).toBe("512 B")
    expect(formatSize(1023)).toBe("1023 B")
  })

  test("bytes 1KB–1MB → KB(1 位小数)", () => {
    expect(formatSize(1024)).toBe("1.0 KB")
    expect(formatSize(1536)).toBe("1.5 KB")
    expect(formatSize(MB - 1)).toBe("1024.0 KB")
  })

  test("bytes 1MB–1GB → MB(1 位小数)", () => {
    expect(formatSize(MB)).toBe("1.0 MB")
    expect(formatSize(15 * MB)).toBe("15.0 MB")
    expect(formatSize(1023 * MB)).toBe("1023.0 MB")
  })

  test("bytes ≥ 1GB → GB(2 位小数)", () => {
    expect(formatSize(1024 * MB)).toBe("1.00 GB")
    expect(formatSize(1536 * MB)).toBe("1.50 GB")
  })
})

describe("SIZE_LIMITS 表完整性", () => {
  test("所有 SizeCategory 都有阈值", () => {
    const cats = ["text", "markdown", "media", "office", "html", "binary", "default"] as const
    for (const c of cats) {
      expect(SIZE_LIMITS[c]).toBeDefined()
    }
  })
})
