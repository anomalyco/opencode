// FORK: md-export-docx 关键纯函数测试 — 2026-05-07
// 关键模块清单内的文件(R5 决策 2),后续逐步补齐到 80% 覆盖率。
// 本批先覆盖最易测、最稳定的 2 个 helper:mimeFromPath / friendlyError。

import { describe, expect, test } from "bun:test"
import { mimeFromPath, friendlyError } from "./md-export-docx"

describe("mimeFromPath", () => {
  test("PNG 图片", () => {
    expect(mimeFromPath("image.png")).toBe("image/png")
    expect(mimeFromPath("path/to/IMG.PNG")).toBe("image/png") // 大小写无关
  })

  test("JPEG 图片(.jpg + .jpeg)", () => {
    expect(mimeFromPath("a.jpg")).toBe("image/jpeg")
    expect(mimeFromPath("a.jpeg")).toBe("image/jpeg")
    expect(mimeFromPath("path/to/PHOTO.JPEG")).toBe("image/jpeg")
  })

  test("常见格式 — gif / webp / svg / bmp / ico / avif", () => {
    expect(mimeFromPath("a.gif")).toBe("image/gif")
    expect(mimeFromPath("a.webp")).toBe("image/webp")
    expect(mimeFromPath("a.svg")).toBe("image/svg+xml")
    expect(mimeFromPath("a.bmp")).toBe("image/bmp")
    expect(mimeFromPath("a.ico")).toBe("image/x-icon")
    expect(mimeFromPath("a.avif")).toBe("image/avif")
  })

  test("未知扩展名返回 null", () => {
    expect(mimeFromPath("file.txt")).toBeNull()
    expect(mimeFromPath("file.pdf")).toBeNull()
    expect(mimeFromPath("file.docx")).toBeNull()
    expect(mimeFromPath("noextension")).toBeNull()
  })

  test("Windows 反斜杠路径仍能识别", () => {
    expect(mimeFromPath("C:\\Users\\x\\photo.png")).toBe("image/png")
    expect(mimeFromPath("D:\\project\\image.JPG")).toBe("image/jpeg")
  })

  test("URL 风格路径", () => {
    expect(mimeFromPath("https://example.com/image.webp")).toBe("image/webp")
    expect(mimeFromPath("./relative/path.svg")).toBe("image/svg+xml")
  })

  test("空字符串返回 null", () => {
    expect(mimeFromPath("")).toBeNull()
  })

  test("仅扩展名(无路径前缀)", () => {
    expect(mimeFromPath(".png")).toBe("image/png")
  })
})

describe("friendlyError", () => {
  describe("文件系统错误", () => {
    test("permission denied / EACCES / EPERM", () => {
      expect(friendlyError("Error: EACCES permission denied")).toContain("无写入权限")
      expect(friendlyError("EPERM: operation not permitted")).toContain("无写入权限")
      expect(friendlyError("PERMISSION DENIED on /path")).toContain("无写入权限")
    })

    test("磁盘空间不足", () => {
      expect(friendlyError("ENOSPC: no space left on device")).toContain("磁盘空间不足")
      expect(friendlyError("disk full")).toContain("磁盘空间不足")
    })

    test("只读文件系统", () => {
      expect(friendlyError("EROFS: read-only file system")).toContain("只读")
    })

    test("路径过长", () => {
      expect(friendlyError("ENAMETOOLONG: path too long")).toContain("路径过长")
    })

    test("文件过大", () => {
      expect(friendlyError("file too large")).toContain("文件过大")
      expect(friendlyError("EMFILE: too many open files")).toContain("文件过大")
    })

    test("路径不存在", () => {
      expect(friendlyError("ENOENT: no such file")).toContain("路径不存在")
      expect(friendlyError("file not found")).toContain("路径不存在")
    })
  })

  describe("库内部错误", () => {
    test("nodebuffer 兼容问题", () => {
      expect(friendlyError("nodebuffer is not supported")).toContain("内部转换错误")
    })

    test("markdown 解析失败", () => {
      expect(friendlyError("invalid markdown syntax")).toContain("解析失败")
      expect(friendlyError("parse error at line 5")).toContain("解析失败")
    })
  })

  describe("兜底行为", () => {
    test("未知错误原样返回", () => {
      const raw = "some unknown weird error"
      expect(friendlyError(raw)).toBe(raw)
    })

    test("空字符串原样返回", () => {
      expect(friendlyError("")).toBe("")
    })
  })

  describe("[详细] 段保留原文(便于排查)", () => {
    test("识别到的错误都附带 [详细]", () => {
      const raw = "EACCES: permission denied"
      const out = friendlyError(raw)
      expect(out).toContain("[详细]")
      expect(out).toContain(raw)
    })
  })
})
