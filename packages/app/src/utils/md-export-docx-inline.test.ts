// FORK: inlineLocalImages 异步测试 — D4 Tauri invoke mock 路径建立 2026-05-07
//
// 单独 test 文件,因 mock.module 会污染同 module 全部 import,
// 不放进 md-export-docx.test.ts(那里跑同步纯函数,不需 mock)。
//
// mock 策略:
// - @tauri-apps/api/core 的 invoke 用可变状态,每个测试 setup 自己的行为
// - @/utils/local-asset 的 resolveAbsolute 不 mock(纯函数 + 已有自己的覆盖)

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

// 可变 mock 状态(每 test 重置)
type InvokeFn = (cmd: string, args: Record<string, unknown>) => Promise<unknown>
let invokeImpl: InvokeFn = async () => {
  throw new Error("invokeImpl not set in this test")
}
const invokeCallLog: Array<{ cmd: string; args: Record<string, unknown> }> = []

// 延迟 import 待测函数(等 mock 注册生效后再 import)
let inlineLocalImages: typeof import("./md-export-docx").inlineLocalImages

beforeAll(async () => {
  mock.module("@tauri-apps/api/core", () => ({
    invoke: (cmd: string, args: Record<string, unknown>) => {
      invokeCallLog.push({ cmd, args })
      return invokeImpl(cmd, args)
    },
  }))
  const mod = await import("./md-export-docx")
  inlineLocalImages = mod.inlineLocalImages
})

beforeEach(() => {
  invokeCallLog.length = 0
  invokeImpl = async () => {
    throw new Error("invokeImpl not set in this test")
  }
})

describe("inlineLocalImages — Tauri invoke mock 路径", () => {
  describe("早返回路径(0 invoke 调用)", () => {
    test("mdFileDir 缺失 → 直接返回 md", async () => {
      const md = "![alt](./image.png)"
      const out = await inlineLocalImages(md, undefined)
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("md 无图片(空字符串)→ 直接返回", async () => {
      const out = await inlineLocalImages("", "/some/dir")
      expect(out).toBe("")
      expect(invokeCallLog.length).toBe(0)
    })

    test("md 无图片(纯文字)→ 直接返回", async () => {
      const md = "# Title\n\nJust text."
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })
  })

  describe("外链跳过(invoke 不被调)", () => {
    test("http URL 跳过", async () => {
      const md = "![](http://example.com/a.png)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("https URL 跳过", async () => {
      const md = "![](https://example.com/a.jpg)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("data: URL 跳过", async () => {
      const md = "![](data:image/png;base64,iVBOR...)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("blob: URL 跳过", async () => {
      const md = "![](blob:https://x/abc)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("file: URL 跳过", async () => {
      const md = "![](file:///c/x.png)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("localasset: URL 跳过", async () => {
      const md = "![](localasset://localhost/abc/img.png)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("协议相对 //(以 // 开头)跳过", async () => {
      const md = "![](//cdn.example.com/a.png)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("锚点 # 跳过", async () => {
      const md = "![](#section)"
      const out = await inlineLocalImages(md, "/some/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })
  })

  describe("本地图片识别 + dataURL 替换", () => {
    test("相对路径 + invoke 成功 → 替换为 dataURL", async () => {
      invokeImpl = async () => "BASE64DATA"
      const md = "![logo](./assets/logo.png)"
      const out = await inlineLocalImages(md, "C:/project/docs")
      expect(out).toContain("data:image/png;base64,BASE64DATA")
      expect(out).toContain("![logo]")
      expect(invokeCallLog.length).toBe(1)
      expect(invokeCallLog[0].cmd).toBe("read_binary_file_base64")
    })

    test("title 保留(![alt](path \"title\")形式)", async () => {
      invokeImpl = async () => "BASE64"
      const md = '![logo](./logo.png "Company Logo")'
      const out = await inlineLocalImages(md, "/dir")
      expect(out).toContain("data:image/png;base64,BASE64")
      expect(out).toContain('"Company Logo"')
    })

    test("不识别的扩展名(.txt)→ 跳过 invoke", async () => {
      const md = "![](./readme.txt)"
      const out = await inlineLocalImages(md, "/dir")
      expect(out).toBe(md)
      expect(invokeCallLog.length).toBe(0)
    })

    test("invoke 失败 → 保留原 markdown 不替换", async () => {
      invokeImpl = async () => {
        throw new Error("read_binary_file_base64: file not found")
      }
      const md = "![](./missing.png)"
      const out = await inlineLocalImages(md, "/dir")
      expect(out).toBe(md) // 失败保留原文
      expect(invokeCallLog.length).toBe(1) // 但 invoke 确实被调过
    })

    test("percent-encoded 路径解码", async () => {
      invokeImpl = async () => "B64"
      const md = "![](./my%20image.png)" // %20 = 空格
      const out = await inlineLocalImages(md, "/dir")
      expect(out).toContain("data:image/png;base64,B64")
      // invoke 收到的应是解码后的路径(含真实空格)
      const args = invokeCallLog[0].args as { path: string }
      expect(args.path).toContain("my image.png")
    })

    test("多张图并发处理", async () => {
      let counter = 0
      invokeImpl = async () => `BASE64_${counter++}`
      const md = "![a](./a.png)\n![b](./b.jpg)\n![c](./c.gif)"
      const out = await inlineLocalImages(md, "/dir")
      // 3 张图都被替换
      expect(out).toContain("data:image/png;base64,BASE64_")
      expect(out).toContain("data:image/jpeg;base64,BASE64_")
      expect(out).toContain("data:image/gif;base64,BASE64_")
      expect(invokeCallLog.length).toBe(3)
    })

    test("混合外链 + 本地图(只本地被调 invoke)", async () => {
      invokeImpl = async () => "B64"
      const md = "![ext](https://x.com/a.png)\n![local](./b.png)\n![data](data:image/png;base64,xx)"
      const out = await inlineLocalImages(md, "/dir")
      // 外链不变
      expect(out).toContain("https://x.com/a.png")
      expect(out).toContain("data:image/png;base64,xx")
      // 本地被替换
      expect(out).toContain("data:image/png;base64,B64")
      // 只调 1 次(本地那张)
      expect(invokeCallLog.length).toBe(1)
    })

    test("absolute 路径(以 / 开头)也能 invoke", async () => {
      invokeImpl = async () => "B64"
      const md = "![](/Users/x/img.png)"
      const out = await inlineLocalImages(md, "/dir")
      expect(out).toContain("data:image/png;base64,B64")
      expect(invokeCallLog.length).toBe(1)
    })

    test("invoke 调用时 root 参数为空字符串(让 absPath 直接生效)", async () => {
      invokeImpl = async () => "B64"
      const md = "![](./img.png)"
      await inlineLocalImages(md, "/dir")
      const args = invokeCallLog[0].args as { root: string; path: string }
      expect(args.root).toBe("")
      expect(args.path).toMatch(/img\.png$/)
    })
  })

  describe("alt 文本保留", () => {
    test("空 alt", async () => {
      invokeImpl = async () => "B64"
      const out = await inlineLocalImages("![](./a.png)", "/dir")
      expect(out).toContain("![](data:image/png;base64,B64)")
    })

    test("含中文的 alt", async () => {
      invokeImpl = async () => "B64"
      const out = await inlineLocalImages("![中文图](./a.png)", "/dir")
      expect(out).toContain("![中文图]")
      expect(out).toContain("data:image/png;base64,B64")
    })
  })
})
