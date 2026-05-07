// FORK: MD → Word 端到端集成测试 — 跑通 exportMdAsDocx 完整流程 2026-05-07
//
// 这是用 D4 mock 模式 + 真 markdown-docx 库的端到端 unit 测试。
// 之前 unit 只覆盖了 8 个 helper 纯函数,主入口 exportMdAsDocx 从没真测过。
// 本笔补完最后一块拼图。
//
// 真实路径(无 mock):
//   markdown 字符串
//   → inlineMermaidPngs(viewerEl,可空)
//   → inlineLocalImages(mdFileDir,可空)
//   → markdownDocx(转 docx 文档对象)
//   → Packer.toBase64String(序列化)
//   → unzipSync(zip 拆包)
//   → mergeCodeBlockParagraphs(代码块段合并)
//   → splitRunsForEmoji(emoji run 切分)
//   → zipSync(重打包)
//   → invoke("write_binary_file_absolute_base64", ...) ← D4 mock 拦
//   → showToast(success / fail)← mock
//
// mock 范围:invoke / showToast / saveDialog(测试传入)
// 真跑:markdown-docx / docx / fflate / 所有 fork helper
//
// 单独 test 文件(mock.module 污染 module 全部 import,与 md-export-docx-inline.test.ts
// 各自独立)。

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { unzipSync, strFromU8 } from "fflate"

// 可变 mock 状态
type InvokeFn = (cmd: string, args: Record<string, unknown>) => Promise<unknown>
let invokeImpl: InvokeFn = async () => {
  throw new Error("invokeImpl not set")
}
const invokeCallLog: Array<{ cmd: string; args: Record<string, unknown> }> = []

const toastCallLog: Array<{ variant?: string; title?: string; description?: string }> = []

// 延迟 import 待测函数
let exportMdAsDocx: typeof import("./md-export-docx").exportMdAsDocx

beforeAll(async () => {
  mock.module("@tauri-apps/api/core", () => ({
    invoke: (cmd: string, args: Record<string, unknown>) => {
      invokeCallLog.push({ cmd, args })
      return invokeImpl(cmd, args)
    },
  }))
  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (opts: { variant?: string; title?: string; description?: string }) => {
      toastCallLog.push(opts)
    },
  }))
  const mod = await import("./md-export-docx")
  exportMdAsDocx = mod.exportMdAsDocx
})

beforeEach(() => {
  invokeCallLog.length = 0
  toastCallLog.length = 0
  invokeImpl = async () => "ok"
})

const i18n = {
  title: "Save as Word document",
  defaultName: "Untitled",
  success: "Exported to Word",
  fail: "Export failed",
}

/** 用户选了路径(saveDialog 返路径)*/
const saveDialogReturning = (path: string | null) => async () => path

describe("exportMdAsDocx — 端到端流程", () => {
  test("用户取消 save 对话框 → 静默退出,不调 invoke / 不显 toast", async () => {
    await exportMdAsDocx({
      markdownText: "# Hello",
      defaultFileName: "test",
      saveDialog: saveDialogReturning(null),
      i18n,
    })
    expect(invokeCallLog.length).toBe(0)
    expect(toastCallLog.length).toBe(0)
  })

  test("简单 md → 走完整流程 → invoke 写盘 + 显 success toast", async () => {
    await exportMdAsDocx({
      markdownText: "# Title\n\nParagraph text.",
      defaultFileName: "doc",
      saveDialog: saveDialogReturning("/tmp/doc.docx"),
      i18n,
    })

    // invoke 调了 1 次,命令 + 路径 + allowOverwrite 都对
    expect(invokeCallLog.length).toBe(1)
    expect(invokeCallLog[0].cmd).toBe("write_binary_file_absolute_base64")
    expect(invokeCallLog[0].args.path).toBe("/tmp/doc.docx")
    expect(invokeCallLog[0].args.allowOverwrite).toBe(true)

    // 输出的 base64Content 是合法 zip(docx 是 zip 容器),解压含 word/document.xml
    const base64 = invokeCallLog[0].args.base64Content as string
    expect(typeof base64).toBe("string")
    expect(base64.length).toBeGreaterThan(100)

    // success toast
    expect(toastCallLog.length).toBe(1)
    expect(toastCallLog[0].variant).toBe("success")
    expect(toastCallLog[0].title).toBe("Exported to Word")
  })

  test("生成的 docx 是合法 zip,含标题文本", async () => {
    await exportMdAsDocx({
      markdownText: "# My Title\n\nHello world.",
      defaultFileName: "test",
      saveDialog: saveDialogReturning("/tmp/test.docx"),
      i18n,
    })

    // 解压验证 docx 结构
    const base64 = invokeCallLog[0].args.base64Content as string
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const zipObj = unzipSync(bytes)

    // docx 必含 word/document.xml + [Content_Types].xml
    expect("word/document.xml" in zipObj).toBe(true)
    expect("[Content_Types].xml" in zipObj).toBe(true)

    // document.xml 含原 markdown 内容
    const docXml = strFromU8(zipObj["word/document.xml"]!)
    expect(docXml).toContain("My Title")
    expect(docXml).toContain("Hello world")
  })

  test("defaultFileName 自动拼 .docx 后缀传 saveDialog", async () => {
    let receivedDefaultPath: string | undefined
    const saveDialog = async (opts?: { defaultPath?: string; title?: string }) => {
      receivedDefaultPath = opts?.defaultPath
      return null // 取消,加快测试
    }
    await exportMdAsDocx({
      markdownText: "# Test",
      defaultFileName: "my-doc",
      saveDialog,
      i18n,
    })
    expect(receivedDefaultPath).toBe("my-doc.docx")
  })

  test("saveDialog 收到 i18n.title 作为对话框标题", async () => {
    let receivedTitle: string | undefined
    const saveDialog = async (opts?: { defaultPath?: string; title?: string }) => {
      receivedTitle = opts?.title
      return null
    }
    await exportMdAsDocx({
      markdownText: "# x",
      defaultFileName: "x",
      saveDialog,
      i18n,
    })
    expect(receivedTitle).toBe("Save as Word document")
  })

  test("invoke 失败 → 显 fail toast + friendlyError 描述", async () => {
    invokeImpl = async () => {
      throw new Error("EACCES: permission denied at /protected/path")
    }
    await exportMdAsDocx({
      markdownText: "# x",
      defaultFileName: "x",
      saveDialog: saveDialogReturning("/protected/path/x.docx"),
      i18n,
    })

    // 走的 catch 分支
    expect(toastCallLog.length).toBe(1)
    expect(toastCallLog[0].variant).toBe("error")
    expect(toastCallLog[0].title).toBe("Export failed")
    // description 应被 friendlyError 处理(EACCES → "无写入权限")
    expect(toastCallLog[0].description).toContain("无写入权限")
    expect(toastCallLog[0].description).toContain("[详细]") // 原文保留
  })

  test("代码块 md → 输出 docx 应触发 mergeCodeBlockParagraphs(段间无空隙)", async () => {
    const md = "```js\nconst a = 1\nconst b = 2\nconst c = 3\n```"
    await exportMdAsDocx({
      markdownText: md,
      defaultFileName: "code",
      saveDialog: saveDialogReturning("/tmp/code.docx"),
      i18n,
    })

    expect(invokeCallLog.length).toBe(1)
    const base64 = invokeCallLog[0].args.base64Content as string
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const docXml = strFromU8(unzipSync(bytes)["word/document.xml"]!)

    // 代码内容应包含(注:syntax 高亮后 const / a / b / c 各成单独 run,不是连续 "const a")
    expect(docXml).toContain(">const<")
    expect(docXml).toContain(">a<")
    expect(docXml).toContain(">b<")
    expect(docXml).toContain(">c<")
    // 经过 mergeCodeBlockParagraphs 的 doc.xml 含 <w:br/>(soft break)
    expect(docXml).toContain("<w:br/>")
    // MdCode 段落级样式应用(代码块识别)
    expect(docXml).toContain('w:val="MdCode"')
  })

  test("emoji md → 输出 docx 含 Segoe UI Emoji 字体覆盖", async () => {
    await exportMdAsDocx({
      markdownText: "Hello 😀 World",
      defaultFileName: "emoji",
      saveDialog: saveDialogReturning("/tmp/emoji.docx"),
      i18n,
    })

    const base64 = invokeCallLog[0].args.base64Content as string
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const docXml = strFromU8(unzipSync(bytes)["word/document.xml"]!)

    // splitRunsForEmoji 应给 emoji 段加 emoji 字体
    expect(docXml).toContain("Segoe UI Emoji")
    // emoji 字符本身保留
    expect(docXml).toContain("😀")
  })

  test("无 mdFileDir → 跳过本地图替换(保留 ![](./img.png) 原文)", async () => {
    // mdFileDir 不传 → inlineLocalImages 直接返回 md 原文
    await exportMdAsDocx({
      markdownText: "![pic](./local.png)",
      defaultFileName: "img",
      saveDialog: saveDialogReturning("/tmp/img.docx"),
      i18n,
      // mdFileDir: 故意不给
    })

    // invoke 还是被调一次(写 docx),但只是写 docx,不再调 read_binary_file_base64
    // (inlineLocalImages 早返回,不调 invoke)
    const reads = invokeCallLog.filter((c) => c.cmd === "read_binary_file_base64")
    expect(reads.length).toBe(0)
    const writes = invokeCallLog.filter((c) => c.cmd === "write_binary_file_absolute_base64")
    expect(writes.length).toBe(1)
  })

  test("含本地图 + mdFileDir → 触发 inlineLocalImages,先 read 后 write", async () => {
    let readCalls = 0
    let writeCalls = 0
    invokeImpl = async (cmd: string) => {
      if (cmd === "read_binary_file_base64") {
        readCalls++
        return "FAKE_PNG_BASE64"
      }
      if (cmd === "write_binary_file_absolute_base64") {
        writeCalls++
        return undefined
      }
      throw new Error("unexpected cmd: " + cmd)
    }

    await exportMdAsDocx({
      markdownText: "![pic](./local.png)\n\n# Title",
      defaultFileName: "img",
      saveDialog: saveDialogReturning("/tmp/img.docx"),
      i18n,
      mdFileDir: "/project/docs",
    })

    expect(readCalls).toBe(1) // 1 张本地图
    expect(writeCalls).toBe(1) // 写 docx
  })

  test("不带 viewerEl → mermaid 块保留为代码块(不抛错)", async () => {
    const md = "```mermaid\ngraph TD\n  A --> B\n```"
    await exportMdAsDocx({
      markdownText: md,
      defaultFileName: "mermaid",
      saveDialog: saveDialogReturning("/tmp/m.docx"),
      i18n,
      // viewerEl: 故意不给 — inlineMermaidPngs 应早返回
    })

    // 不应该抛错;success toast 出
    expect(toastCallLog.length).toBe(1)
    expect(toastCallLog[0].variant).toBe("success")
  })
})
