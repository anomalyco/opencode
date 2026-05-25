// [fork-only] reply-actions 单测
// [feat: feishu-bridge-light] 2026-05-23

import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  classifyAttachment,
  IMBOT_WORKSPACE_ROOT,
  GROUP_NAME_MAX_LEN,
  isBotMentioned,
  isGroupCreationIntent,
  parseAttachMarkers,
  parseGroupCommand,
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

  test("默认 workspaceRoot = ~/.opencode/imbot-workspace", () => {
    const inWs = join(IMBOT_WORKSPACE_ROOT, "test.png")
    expect(classifyAttachment(inWs).kind).toBe("image")
    expect(IMBOT_WORKSPACE_ROOT).toBe(join(homedir(), ".opencode", "imbot-workspace"))
  })
})

// ============================================================
// parseGroupCommand — /group <群名> slash command
// [feat: feishu-group-slash-command] 2026-05-24
// ============================================================

describe("parseGroupCommand", () => {
  test("/group 项目讨论 → matched: true, groupName: 项目讨论", () => {
    const r = parseGroupCommand("/group 项目讨论")
    expect(r).toEqual({ matched: true, groupName: "项目讨论" })
  })

  test("/group (无参数) → matched: true, error: no_name", () => {
    const r = parseGroupCommand("/group")
    expect(r).toEqual({ matched: true, groupName: null, error: "no_name" })
  })

  test("'/group ' (trailing space 无群名) → matched: true, error: no_name", () => {
    const r = parseGroupCommand("/group ")
    expect(r).toEqual({ matched: true, groupName: null, error: "no_name" })
  })

  test("/group project plan 2026 → 群名允许内部空格", () => {
    const r = parseGroupCommand("/group project plan 2026")
    expect(r).toEqual({ matched: true, groupName: "project plan 2026" })
  })

  test("超 30 字符群名 → matched: true, error: too_long", () => {
    const longName = "a".repeat(31)
    const r = parseGroupCommand(`/group ${longName}`)
    expect(r).toEqual({ matched: true, groupName: null, error: "too_long" })
  })

  test("恰好 30 字符 → 通过(边界)", () => {
    const name = "a".repeat(30)
    const r = parseGroupCommand(`/group ${name}`)
    expect(r).toEqual({ matched: true, groupName: name })
  })

  test("/groupabc(粘连)→ matched: false", () => {
    expect(parseGroupCommand("/groupabc")).toEqual({ matched: false, groupName: null })
  })

  test("/Group X(大写)→ matched: false(跟 /new 一致大小写敏感)", () => {
    expect(parseGroupCommand("/Group X")).toEqual({ matched: false, groupName: null })
  })

  test("普通文本不是命令 → matched: false", () => {
    expect(parseGroupCommand("帮我建群")).toEqual({ matched: false, groupName: null })
  })

  test("空 / undefined / null → matched: false 安全返回", () => {
    expect(parseGroupCommand("")).toEqual({ matched: false, groupName: null })
    expect(parseGroupCommand(undefined as unknown as string)).toEqual({
      matched: false,
      groupName: null,
    })
    expect(parseGroupCommand(null as unknown as string)).toEqual({
      matched: false,
      groupName: null,
    })
  })

  test("外层空格 trim → 内部命中", () => {
    const r = parseGroupCommand("   /group 项目讨论   ")
    expect(r).toEqual({ matched: true, groupName: "项目讨论" })
  })

  test("GROUP_NAME_MAX_LEN export = 30", () => {
    expect(GROUP_NAME_MAX_LEN).toBe(30)
  })
})

// ============================================================
// isGroupCreationIntent — 白名单短语 + 查询后缀排除
// [feat: feishu-group-slash-command] 2026-05-24
// ============================================================

describe("isGroupCreationIntent (白名单 + 查询排除)", () => {
  // Tier 1 中文短语全命中
  test.each([
    ["帮我建群", true],
    ["请创建群", true],
    ["新建群", true],
    ["拉群讨论", true],
  ])("Tier 1 中文 \"%s\" → %s", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // Tier 2 中文口语变体抽样(均含 contiguous Tier 2 短语)
  test.each([
    ["帮我建个群", true],         // 含 "建个群"
    ["拉个群我们聊", true],        // 含 "拉个群"
    ["拉一个群", true],           // 含 "拉一个群"
    ["开个群", true],            // 含 "开个群"
    ["开一个群", true],           // 含 "开一个群"
    ["新建个群", true],          // 含 "新建个群"
    ["创建一个群", true],         // 含 "创建一个群"
  ])("Tier 2 中文 \"%s\" → %s", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // 已知漏拦(白名单 strict substring 设计 trade)— 这类 "建一个X群" 的 X 插入断开了
  // contiguous 匹配。User 应改用 /group <群名> 显式命令或换"建群叫 X" 短语。
  test.each([
    ["建一个项目讨论群", false],
    ["创建一个项目群", false],
  ])("已知漏拦 \"%s\" → false(中间字插入断开 contiguous,user 改用 /group)", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // 中文查询后缀排除 — 命中短语但意图是查询
  test.each([
    ["建群怎么操作", false],
    ["建群如何使用", false],
    ["拉群方法是什么", false],
    ["创建群步骤", false],
    ["建一个群流程怎么走", false],
    ["建群教程", false],
    ["为什么要建群", false],
  ])("中文查询排除 \"%s\" → %s", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // 已知误拦 → 现在不命中(白名单短语都不含)
  test.each([
    ["建立群体精神", false],
    ["新群规", false],
    ["群规怎么定", false],
    ["建立群众基础", false],
    ["群是怎么建的", false],
    ["建立公司", false],
    ["群讨论", false],
    ["今天天气真好", false],
  ])("不命中 \"%s\" → false(短语不在白名单)", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // 英文 4 个白名单短语
  test.each([
    ["create a group for the team", true],
    ["make a group called X", true],
    ["start a group", true],
    ["new group called dev", true],
  ])("英文 \"%s\" → %s", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // 英文 lowercase 比较
  test("CREATE A GROUP → 大写也命中(lowercase 比较)", () => {
    expect(isGroupCreationIntent("CREATE A GROUP NOW")).toBe(true)
  })

  // 英文查询后缀排除
  test.each([
    ["create a group how", false],
    ["create a group how to use", false],
  ])("英文查询排除 \"%s\" → %s", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // new group 专用排除(noun phrase)
  test.each([
    ["new group rule", false],
    ["new group of users", false],
    ["new group policy", false],
    ["new group chat history", false],
    ["new group channel", false],
    ["new group members", false],
    ["new group settings", false],
  ])("\"new group\" noun phrase 排除 \"%s\" → %s", (text, expected) => {
    expect(isGroupCreationIntent(text as string)).toBe(expected)
  })

  // 空 / 非字符串安全返回 false
  test("空 / undefined / null → false", () => {
    expect(isGroupCreationIntent("")).toBe(false)
    expect(isGroupCreationIntent(undefined as unknown as string)).toBe(false)
    expect(isGroupCreationIntent(null as unknown as string)).toBe(false)
  })

  test("纯净中文命中 → true(无查询后缀)", () => {
    expect(isGroupCreationIntent("帮我建群叫项目讨论吧")).toBe(true)
  })
})

// ============================================================
// isBotMentioned — bot @ 检测
// [feat: feishu-group-mention-policy] 2026-05-24
// ============================================================

describe("isBotMentioned (botName 匹配)", () => {
  // [feat: feishu-group-mention-policy] hot fix 2026-05-24 —
  // 原 openId 匹配是错维度,改用 botName 匹配 mentions[].name
  function mn(name: string, key = "_user_1"): MentionRef {
    return { key, name, openId: `ou_${name}` }
  }

  test("mentions 含 botName → true", () => {
    expect(isBotMentioned([mn("DeskFox-Mac")], "DeskFox-Mac")).toBe(true)
  })

  test("mentions 含其他人但不含 bot → false", () => {
    expect(isBotMentioned([mn("alice"), mn("bob")], "DeskFox-Mac")).toBe(false)
  })

  test("多 mention 含 bot → true", () => {
    expect(
      isBotMentioned([mn("alice"), mn("DeskFox-Mac"), mn("bob")], "DeskFox-Mac"),
    ).toBe(true)
  })

  test("空 mentions → false", () => {
    expect(isBotMentioned([], "DeskFox-Mac")).toBe(false)
  })

  test("botName 空串 → true(fail open,fetchBotName 失败时避免吞群消息)", () => {
    expect(isBotMentioned([mn("anyone")], "")).toBe(true)
  })

  test("botName 大小写不匹配 → false(精准比较)", () => {
    expect(isBotMentioned([mn("DeskFox-Mac")], "deskfox-mac")).toBe(false)
  })

  test("中文/emoji bot 名也工作", () => {
    expect(isBotMentioned([mn("灵狐🦊-Mac")], "灵狐🦊-Mac")).toBe(true)
  })

  test("@ alice + bot 都在 → true(只要 bot 名出现)", () => {
    expect(isBotMentioned([mn("alice"), mn("DeskFox-Mac")], "DeskFox-Mac")).toBe(true)
  })
})
