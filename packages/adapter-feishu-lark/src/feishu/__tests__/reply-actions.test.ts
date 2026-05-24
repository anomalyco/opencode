// [fork-only] reply-actions 单测
// [feat: feishu-bridge-light] 2026-05-23

import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  classifyAttachment,
  FEISHU_WORKSPACE_ROOT,
  parseAttachMarkers,
  parseCreateGroupMarkers,
  stripMentions,
  type MentionRef,
} from "../reply-actions"

function mention(key: string): MentionRef {
  return { key, name: `bot-${key}`, openId: `ou_${key}` }
}

describe("stripMentions", () => {
  test("空 mentions → 仅 trim", () => {
    expect(stripMentions("  hello  ", [])).toBe("hello")
  })

  test("单 mention 前缀 → strip + trim", () => {
    expect(stripMentions("@_user_1 /new", [mention("_user_1")])).toBe("/new")
  })

  test("单 mention 中缀 → strip(后续空格被 \\s* 吞掉)", () => {
    // regex `@key\s*` 贪婪吃掉 mention 后空格,所以 "foo @_user_1 bar" → "foo bar"
    expect(stripMentions("foo @_user_1 bar", [mention("_user_1")])).toBe("foo bar")
  })

  test("多 mention → 全 strip", () => {
    expect(
      stripMentions("@_user_1 @_user_2 hello", [mention("_user_1"), mention("_user_2")]),
    ).toBe("hello")
  })

  test("mention key 不出现 → text 不变(仅 trim)", () => {
    expect(stripMentions("  @other_key /new  ", [mention("_user_1")])).toBe("@other_key /new")
  })

  test("mention key 含 regex 特殊字符 → 防御性转义不抛", () => {
    // 防御性 case:虽然飞书实际不会出现,但实现不能 crash
    expect(stripMentions("@a.b /new", [{ key: "a.b", name: "x" }])).toBe("/new")
    // 验证不是 . 通配 "@axb /new" 应原样保留
    expect(stripMentions("@axb /new", [{ key: "a.b", name: "x" }])).toBe("@axb /new")
  })

  test("私聊场景:text 无 @ → 仅 trim", () => {
    expect(stripMentions("  /new  ", [])).toBe("/new")
  })

  test("@_user_N 后无空格 → 仍 strip(空格 0 或多个均认)", () => {
    expect(stripMentions("@_user_1/new", [mention("_user_1")])).toBe("/new")
  })
})

// ============================================================
// parseAttachMarkers — [ATTACH:path] 解析 + strip
// ============================================================

describe("parseAttachMarkers", () => {
  test("无 marker → paths 空,cleanText 原样 trim", () => {
    const r = parseAttachMarkers("  hello world  ")
    expect(r.paths).toEqual([])
    expect(r.cleanText).toBe("hello world")
  })

  test("单 marker → 提取 path,strip marker", () => {
    const r = parseAttachMarkers("看图 [ATTACH:/abs/path/img.png] 完毕")
    expect(r.paths).toEqual(["/abs/path/img.png"])
    expect(r.cleanText).toBe("看图  完毕")
  })

  test("多 marker → 按出现顺序", () => {
    const r = parseAttachMarkers(
      "图一 [ATTACH:/a/1.png] 文档一 [ATTACH:/a/1.pdf] 完毕",
    )
    expect(r.paths).toEqual(["/a/1.png", "/a/1.pdf"])
    expect(r.cleanText).toBe("图一  文档一  完毕")
  })

  test("marker 单独成段(前后换行)→ strip 后多空行收敛", () => {
    const r = parseAttachMarkers("前文\n\n[ATTACH:/a.png]\n\n后文")
    expect(r.paths).toEqual(["/a.png"])
    expect(r.cleanText).toBe("前文\n\n后文")
  })

  test("marker 全在,无其它文字 → cleanText 为空", () => {
    const r = parseAttachMarkers("[ATTACH:/a.png][ATTACH:/b.pdf]")
    expect(r.paths).toEqual(["/a.png", "/b.pdf"])
    expect(r.cleanText).toBe("")
  })

  test("path 含空格 → trim 但保留中间空格", () => {
    const r = parseAttachMarkers("[ATTACH:  /a b/c.png  ]")
    expect(r.paths).toEqual(["/a b/c.png"])
  })

  test("空 marker [ATTACH:] → 跳过", () => {
    const r = parseAttachMarkers("[ATTACH:]")
    expect(r.paths).toEqual([])
  })

  test("行尾空格 + 三个以上空行清理", () => {
    const r = parseAttachMarkers("foo   \n[ATTACH:/a.png]\n\n\n\nbar")
    expect(r.paths).toEqual(["/a.png"])
    expect(r.cleanText).toBe("foo\n\n\nbar".replace(/\n{3,}/g, "\n\n"))
  })
})

// ============================================================
// classifyAttachment — 扩展名分流 + workspace 白名单
// ============================================================

describe("classifyAttachment", () => {
  const ROOT = "/tmp/test-workspace"

  test("workspace 内 .png → image", () => {
    expect(classifyAttachment(`${ROOT}/foo/a.png`, ROOT)).toEqual({ kind: "image" })
  })

  test("workspace 内 .jpg/.JPEG/.gif/.webp/.bmp/.tiff/.ico → image", () => {
    for (const ext of [".jpg", ".JPEG", ".gif", ".webp", ".bmp", ".tiff", ".ico"]) {
      expect(classifyAttachment(`${ROOT}/img${ext}`, ROOT).kind).toBe("image")
    }
  })

  test("workspace 内 .pdf → file pdf", () => {
    expect(classifyAttachment(`${ROOT}/a.pdf`, ROOT)).toEqual({ kind: "file", fileType: "pdf" })
  })

  test("枚举 doc/xls/ppt/mp4/opus 映射对", () => {
    expect(classifyAttachment(`${ROOT}/a.doc`, ROOT)).toEqual({ kind: "file", fileType: "doc" })
    expect(classifyAttachment(`${ROOT}/a.xls`, ROOT)).toEqual({ kind: "file", fileType: "xls" })
    expect(classifyAttachment(`${ROOT}/a.ppt`, ROOT)).toEqual({ kind: "file", fileType: "ppt" })
    expect(classifyAttachment(`${ROOT}/a.mp4`, ROOT)).toEqual({ kind: "file", fileType: "mp4" })
    expect(classifyAttachment(`${ROOT}/a.opus`, ROOT)).toEqual({ kind: "file", fileType: "opus" })
  })

  test("docx/xlsx/pptx/txt/md/zip → file stream 兜底", () => {
    for (const ext of [".docx", ".xlsx", ".pptx", ".txt", ".md", ".zip"]) {
      expect(classifyAttachment(`${ROOT}/a${ext}`, ROOT)).toEqual({
        kind: "file",
        fileType: "stream",
      })
    }
  })

  test("相对路径 → reject", () => {
    expect(classifyAttachment("./a.png", ROOT)).toEqual({
      kind: "reject",
      reason: "非绝对路径",
    })
    expect(classifyAttachment("a.png", ROOT)).toEqual({
      kind: "reject",
      reason: "非绝对路径",
    })
  })

  test("workspace 外的绝对路径 → reject", () => {
    const r = classifyAttachment("/etc/passwd", ROOT)
    expect(r.kind).toBe("reject")
    expect((r as { reason: string }).reason).toContain("在 workspace 外")
  })

  test("路径越界 ../ → resolve 后判定 reject(防 traversal)", () => {
    // /tmp/test-workspace/../etc/passwd → /tmp/etc/passwd (resolve 后),不在 workspace
    const r = classifyAttachment(`${ROOT}/../etc/passwd`, ROOT)
    expect(r.kind).toBe("reject")
  })

  test("workspace 同名前缀(/tmp/test-workspace-evil)→ reject(防 prefix 误判)", () => {
    // 若直接 startsWith(root) 不加 sep 会误认为同名前缀目录合法
    const r = classifyAttachment("/tmp/test-workspace-evil/a.png", ROOT)
    expect(r.kind).toBe("reject")
  })

  test("workspace 根本身(无文件名)→ file stream(无 ext)", () => {
    // 极端 case:path === workspaceRoot 时 startsWith 加 sep 校验会拒,
    // 但实现里有 norm === workspaceRoot 的兜底允许;无 ext 走 stream
    expect(classifyAttachment(ROOT, ROOT)).toEqual({ kind: "file", fileType: "stream" })
  })

  test("默认 workspaceRoot = ~/.opencode/feishu-workspace", () => {
    const inWs = join(FEISHU_WORKSPACE_ROOT, "test.png")
    expect(classifyAttachment(inWs).kind).toBe("image")
    expect(FEISHU_WORKSPACE_ROOT).toBe(join(homedir(), ".opencode", "feishu-workspace"))
  })
})

// ============================================================
// parseCreateGroupMarkers — [CREATE_GROUP:name] 解析 + strip
// ============================================================

describe("parseCreateGroupMarkers", () => {
  test("无 marker → names 空,cleanText 原样 trim", () => {
    const r = parseCreateGroupMarkers("  普通回复  ")
    expect(r.names).toEqual([])
    expect(r.cleanText).toBe("普通回复")
  })

  test("单 marker → 提取群名", () => {
    const r = parseCreateGroupMarkers("我创建一个 [CREATE_GROUP:需求讨论] 好了")
    expect(r.names).toEqual(["需求讨论"])
    expect(r.cleanText).toBe("我创建一个  好了")
  })

  test("多 marker → 按出现顺序", () => {
    const r = parseCreateGroupMarkers("先 [CREATE_GROUP:A] 再 [CREATE_GROUP:B]")
    expect(r.names).toEqual(["A", "B"])
  })

  test("群名 trim + 内嵌空格保留", () => {
    const r = parseCreateGroupMarkers("[CREATE_GROUP:  需求 讨论组  ]")
    expect(r.names).toEqual(["需求 讨论组"])
  })

  test("空 marker [CREATE_GROUP:] → 跳过", () => {
    const r = parseCreateGroupMarkers("[CREATE_GROUP:]")
    expect(r.names).toEqual([])
  })

  test("跟 ATTACH marker 独立 — CREATE_GROUP 不解析 ATTACH", () => {
    const r = parseCreateGroupMarkers("[ATTACH:/a.png] [CREATE_GROUP:讨论]")
    expect(r.names).toEqual(["讨论"])
    // ATTACH marker 仍在 cleanText 里(本函数只 strip 自己的 marker)
    expect(r.cleanText).toContain("[ATTACH:/a.png]")
  })

  test("跟 ATTACH 联合 — 调用方应链式调两个 parser", () => {
    const groupParse = parseCreateGroupMarkers("[ATTACH:/a.png] [CREATE_GROUP:讨论]")
    const attachParse = parseAttachMarkers(groupParse.cleanText)
    expect(groupParse.names).toEqual(["讨论"])
    expect(attachParse.paths).toEqual(["/a.png"])
    expect(attachParse.cleanText).toBe("")
  })
})
