// [fork-only] reply-actions 单测
// [feat: feishu-bridge-light] 2026-05-23

import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  classifyAttachment,
  extractGroupName,
  FEISHU_WORKSPACE_ROOT,
  isBotMentioned,
  isGroupCreationIntent,
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

// ============================================================
// isGroupCreationIntent (Phase 2 hard block)
// [feat: feishu-create-group-hard-block] 2026-05-24
// ============================================================

describe("isGroupCreationIntent", () => {
  // 中文命中 case
  test("'帮我建群' → true", () => {
    expect(isGroupCreationIntent("帮我建群")).toBe(true)
  })

  test("'帮我建一个 X 项目讨论群' → true(建一个群 substring)", () => {
    expect(isGroupCreationIntent("帮我建一个 X 项目讨论群")).toBe(true)
  })

  test("'拉个群讨论吧' → true", () => {
    expect(isGroupCreationIntent("拉个群讨论吧")).toBe(true)
  })

  test("'我想新建群' → true(新建群)", () => {
    expect(isGroupCreationIntent("我想新建群")).toBe(true)
  })

  test("'再帮我创建一个新群,名字叫 test 002' → true(创建群 substring)", () => {
    expect(isGroupCreationIntent("再帮我创建一个新群,名字叫 test 002")).toBe(true)
  })

  // 英文命中 case
  test("'create a group for us' → true", () => {
    expect(isGroupCreationIntent("create a group for us")).toBe(true)
  })

  test("'CREATE GROUP test' → true(大小写不敏感)", () => {
    expect(isGroupCreationIntent("CREATE GROUP test")).toBe(true)
  })

  test("'please make group called dev-talk' → true", () => {
    expect(isGroupCreationIntent("please make group called dev-talk")).toBe(true)
  })

  // 不命中 case
  test("'群是怎么建的?' → false(含'建'但不含'建群')", () => {
    expect(isGroupCreationIntent("群是怎么建的?")).toBe(false)
  })

  test("'今天天气真好' → false", () => {
    expect(isGroupCreationIntent("今天天气真好")).toBe(false)
  })

  test("'how do I create a new project' → false(含 create + new 但不组成关键字)", () => {
    expect(isGroupCreationIntent("how do I create a new project")).toBe(false)
  })

  // edge case
  test("空串 → false", () => {
    expect(isGroupCreationIntent("")).toBe(false)
  })

  test("null / undefined → false(防御性,实际上 TypeScript 不会传)", () => {
    expect(isGroupCreationIntent(undefined as unknown as string)).toBe(false)
    expect(isGroupCreationIntent(null as unknown as string)).toBe(false)
  })

  test("number 类型 → false", () => {
    expect(isGroupCreationIntent(123 as unknown as string)).toBe(false)
  })

  // 1-spec 已知误拦 — 接受
  test("'如何创建一个群?' → true(已知误拦,user 问知识但命中'创建...群'模式)", () => {
    expect(isGroupCreationIntent("如何创建一个群?")).toBe(true)
  })

  // regex 比 substring 精准:动词 + 群 才命中,'新群规'里'新'不是动词,正确不拦
  test("'新群规是什么?' → false(regex 比 substring 精准,'新'非动词不命中)", () => {
    expect(isGroupCreationIntent("新群规是什么?")).toBe(false)
  })

  // 更多 regex 边界测
  test("'帮我建一个项目讨论群' → true(动词'建' + 字符 + '群')", () => {
    expect(isGroupCreationIntent("帮我建一个项目讨论群")).toBe(true)
  })

  test("'拉个群讨论这个 bug' → true", () => {
    expect(isGroupCreationIntent("拉个群讨论这个 bug")).toBe(true)
  })

  test("'群讨论是什么意思' → false('群'在动词前)", () => {
    expect(isGroupCreationIntent("群讨论是什么意思")).toBe(false)
  })

  test("'建立公司' → false(无'群')", () => {
    expect(isGroupCreationIntent("建立公司")).toBe(false)
  })

  test("'set up a group for the team' → true(英文 'set up a group')", () => {
    expect(isGroupCreationIntent("set up a group for the team")).toBe(true)
  })
})

// ============================================================
// extractGroupName — 群名提取(direct dispatch 用)
// [feat: feishu-create-group-hard-block] 2026-05-24
// ============================================================

describe("extractGroupName", () => {
  // 中文 "叫" 模式
  test("'帮我建群叫 test 006' → 'test 006'", () => {
    expect(extractGroupName("帮我建群叫 test 006")).toBe("test 006")
  })

  test("'建个群叫做 X' → 'X'", () => {
    expect(extractGroupName("建个群叫做 X")).toBe("X")
  })

  // 中文 "名字" / "名为" 模式
  test("'建群名字叫 我的群' → '我的群'", () => {
    expect(extractGroupName("建群名字叫 我的群")).toBe("我的群")
  })

  test("'建群名字为 工作组' → '工作组'", () => {
    expect(extractGroupName("建群名字为 工作组")).toBe("工作组")
  })

  test("'建群名为 团队会' → '团队会'", () => {
    expect(extractGroupName("建群名为 团队会")).toBe("团队会")
  })

  test("'拉个群命名 项目讨论' → '项目讨论'", () => {
    expect(extractGroupName("拉个群命名 项目讨论")).toBe("项目讨论")
  })

  test("'建群命名为 一个组' → '一个组'", () => {
    expect(extractGroupName("建群命名为 一个组")).toBe("一个组")
  })

  // 英文模式
  test("'create group called test' → 'test'", () => {
    expect(extractGroupName("create group called test")).toBe("test")
  })

  test("'create new group named foo' → 'foo'", () => {
    expect(extractGroupName("create new group named foo")).toBe("foo")
  })

  test("'CREATE GROUP CALLED Test' → 'Test'(大小写不敏感)", () => {
    expect(extractGroupName("CREATE GROUP CALLED Test")).toBe("Test")
  })

  // 分隔符锚定 — 多句不贪婪
  test("'建群叫 Foo, 然后把人拉进来' → 'Foo'(逗号锚定)", () => {
    expect(extractGroupName("建群叫 Foo, 然后把人拉进来")).toBe("Foo")
  })

  test("'建群叫 X。把所有人拉进来' → 'X'(句号锚定)", () => {
    expect(extractGroupName("建群叫 X。把所有人拉进来")).toBe("X")
  })

  // 不提取(没 name keyword)
  test("'帮我建群' → null(没说群名)", () => {
    expect(extractGroupName("帮我建群")).toBeNull()
  })

  test("'建一个项目讨论群' → null(没 name keyword)", () => {
    expect(extractGroupName("建一个项目讨论群")).toBeNull()
  })

  test("'create a group for us' → null(没 called/named)", () => {
    expect(extractGroupName("create a group for us")).toBeNull()
  })

  // 边界
  test("空串 → null", () => {
    expect(extractGroupName("")).toBeNull()
  })

  test("undefined / null → null(防御)", () => {
    expect(extractGroupName(undefined as unknown as string)).toBeNull()
    expect(extractGroupName(null as unknown as string)).toBeNull()
  })

  // trim
  test("群名前后空格 → trim", () => {
    expect(extractGroupName("建群叫   test  ,然后...")).toBe("test")
  })

  // [follow-up 2026-05-24] 扩展 introducer:群名 / 名称 / 起名 三组
  test("'建个群 群名是012' → '012'", () => {
    expect(extractGroupName("建个群 群名是012")).toBe("012")
  })

  test("'帮我建个群,群名是012' → '012'", () => {
    expect(extractGroupName("帮我建个群,群名是012")).toBe("012")
  })

  test("'帮我建群,群名叫 X' → 'X'", () => {
    expect(extractGroupName("帮我建群,群名叫 X")).toBe("X")
  })

  test("'建群,群名为 工作组' → '工作组'", () => {
    expect(extractGroupName("建群,群名为 工作组")).toBe("工作组")
  })

  test("'建群,名字是 我的群' → '我的群'(名字是)", () => {
    expect(extractGroupName("建群,名字是 我的群")).toBe("我的群")
  })

  test("'建群,名称叫 工作组' → '工作组'(名称叫)", () => {
    expect(extractGroupName("建群,名称叫 工作组")).toBe("工作组")
  })

  test("'建群,名称是 X' → 'X'", () => {
    expect(extractGroupName("建群,名称是 X")).toBe("X")
  })

  test("'建群名叫 团队会' → '团队会'(名叫)", () => {
    expect(extractGroupName("建群名叫 团队会")).toBe("团队会")
  })

  test("'建群名是 工作组' → '工作组'(名是)", () => {
    expect(extractGroupName("建群名是 工作组")).toBe("工作组")
  })

  test("'拉个群起名 项目讨论' → '项目讨论'(起名)", () => {
    expect(extractGroupName("拉个群起名 项目讨论")).toBe("项目讨论")
  })

  test("'拉个群起名叫 项目讨论' → '项目讨论'(起名叫)", () => {
    expect(extractGroupName("拉个群起名叫 项目讨论")).toBe("项目讨论")
  })

  // [follow-up 2026-05-24] short form:动词+群+空格+名字
  test("'帮我建群 012' → '012'(短形式,动词后空格)", () => {
    expect(extractGroupName("帮我建群 012")).toBe("012")
  })

  test("'建群 项目讨论' → '项目讨论'(短形式)", () => {
    expect(extractGroupName("建群 项目讨论")).toBe("项目讨论")
  })

  test("'拉个群 我们组' → '我们组'(拉+群+空格+名字)", () => {
    expect(extractGroupName("拉个群 我们组")).toBe("我们组")
  })

  test("'创建讨论群 X' → 'X'(动词+字符+群+空格+名字)", () => {
    expect(extractGroupName("创建讨论群 X")).toBe("X")
  })

  // 短形式不应误吞:动词+群+无空格 → 不匹配
  test("'建群讨论' → null(无空格,'讨论' 应被当延续不是名字)", () => {
    expect(extractGroupName("建群讨论")).toBeNull()
  })

  test("'建群讨论这个 bug' → null(无空格分隔)", () => {
    expect(extractGroupName("建群讨论这个 bug")).toBeNull()
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
