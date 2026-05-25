// FORK: [feat: 聊天选区-卡片化-换行] 2026-05-25
// 验 formatCommentNote 对 kind="chat" 与 file/默认的模板分流
import { describe, expect, test } from "bun:test"
import { formatCommentNote, createCommentMetadata, readCommentMetadata } from "../comment-note"

describe("formatCommentNote — kind 分流", () => {
  test("kind='chat' 走聊天引用模板,含 preview 段", () => {
    const out = formatCommentNote({
      path: "<chat selection>",
      comment: "总结一下",
      preview: "这是我之前说的一段话",
      kind: "chat",
    })
    expect(out).toContain("quoting text from earlier in this conversation")
    expect(out).toContain('"""\n这是我之前说的一段话\n"""')
    expect(out).toContain("Their follow-up question/comment: 总结一下")
    // 不应该出现 file 模板的字眼
    expect(out).not.toContain("regarding this file")
  })

  test("kind='chat' 无 preview 时只输出 comment 段不漏 quoteSection", () => {
    const out = formatCommentNote({
      path: "<chat selection>",
      comment: "只 comment 无 preview",
      kind: "chat",
    })
    expect(out).toContain("Their follow-up question/comment: 只 comment 无 preview")
    expect(out).not.toContain("quoting text from earlier")
  })

  test("kind='file' 走原有 file 模板", () => {
    const out = formatCommentNote({
      path: "src/foo.ts",
      selection: { startLine: 5, startChar: 0, endLine: 8, endChar: 0 },
      comment: "解释下",
      preview: "function foo() { return 42 }",
      kind: "file",
    })
    expect(out).toContain("regarding lines 5 through 8 of src/foo.ts")
    expect(out).toContain('Selected text:\n"""\nfunction foo() { return 42 }\n"""')
  })

  test("kind 未指定时走 file 模板(向后兼容)", () => {
    const out = formatCommentNote({
      path: "src/bar.ts",
      comment: "看看",
    })
    expect(out).toContain("regarding this file of src/bar.ts")
  })
})

describe("createCommentMetadata / readCommentMetadata — kind 透传", () => {
  test("kind='chat' round-trip", () => {
    const meta = createCommentMetadata({
      path: "<chat>",
      comment: "x",
      preview: "y",
      kind: "chat",
      origin: "quote",
    })
    const parsed = readCommentMetadata(meta)
    expect(parsed?.kind).toBe("chat")
    expect(parsed?.origin).toBe("quote")
  })

  test("非法 kind 值返 undefined", () => {
    const parsed = readCommentMetadata({
      opencodeComment: {
        path: "x",
        comment: "y",
        kind: "invalid-kind",
      },
    })
    expect(parsed?.kind).toBeUndefined()
  })
})
