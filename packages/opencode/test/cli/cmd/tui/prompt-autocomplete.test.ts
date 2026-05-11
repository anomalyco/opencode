import { describe, expect, test } from "bun:test"
import { mentionTriggerIndex } from "../../../../src/cli/cmd/tui/component/prompt/autocomplete-trigger"

describe("mentionTriggerIndex", () => {
  test("returns offset for mention triggers at the start or after ascii text", () => {
    expect(mentionTriggerIndex("@")).toBe(0)
    expect(mentionTriggerIndex("test @")).toBe(5)
  })

  test("returns display-width offset for CJK text before @", () => {
    expect(mentionTriggerIndex("中文 @")).toBe(5)
    expect(mentionTriggerIndex("こんにちは @")).toBe(11)
    expect(mentionTriggerIndex("한국어 @")).toBe(7)
    expect(mentionTriggerIndex("🙂 @")).toBe(3)
  })

  test("does not trigger inside ascii words or after whitespace in the query", () => {
    expect(mentionTriggerIndex("中文@")).toBeUndefined()
    expect(mentionTriggerIndex("こんにちは@")).toBeUndefined()
    expect(mentionTriggerIndex("한국어@")).toBeUndefined()
    expect(mentionTriggerIndex("🙂@")).toBeUndefined()
    expect(mentionTriggerIndex("hello@")).toBeUndefined()
    expect(mentionTriggerIndex("foo@bar.com")).toBeUndefined()
    expect(mentionTriggerIndex("中文 @src file")).toBeUndefined()
  })
})
