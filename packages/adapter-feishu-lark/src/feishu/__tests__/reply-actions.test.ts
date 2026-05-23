// [fork-only] reply-actions 单测
// [feat: feishu-bridge-light] 2026-05-23

import { describe, expect, test } from "bun:test"
import { stripMentions, type MentionRef } from "../reply-actions"

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
