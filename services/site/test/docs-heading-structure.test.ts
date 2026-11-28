import { describe, expect, test } from "bun:test"
import { currentTranslation, headingDepths, sameHeadingStructure } from "../src/docs/lib/heading-structure"

describe("translated page structure", () => {
  const english = `---\ntitle: "Instructions"\n---\n\n## Scope\n\nText.\n\n### Fallback\n\n\`\`\`md\n## Not a heading\n\`\`\`\n\n## Discovery\n`

  test("reads heading depths in order, outside frontmatter and fenced code", () => {
    expect(headingDepths(english)).toEqual([2, 3, 2])
    expect(headingDepths("---\ntitle: x\n---\n# Title\n## One\n")).toEqual([1, 2])
  })

  test("a translation with the English page's headings matches", () => {
    const translated = `---\ntitle: "指令"\n---\n\n## 适用范围\n\n内容。\n\n### 回退\n\n\`\`\`text\n## 代码里的井号\n\`\`\`\n\n## 发现\n`
    expect(sameHeadingStructure(headingDepths(english), headingDepths(translated))).toBe(true)
  })

  test("an added, removed or reordered heading is stale", () => {
    const added = "## 适用范围\n\n### 回退\n\n## 新增\n\n## 发现\n"
    const removed = "## 适用范围\n\n## 发现\n"
    const reordered = "### 回退\n\n## 发现\n\n## 适用范围\n"
    expect(sameHeadingStructure(headingDepths(english), headingDepths(added))).toBe(false)
    expect(sameHeadingStructure(headingDepths(english), headingDepths(removed))).toBe(false)
    expect(sameHeadingStructure(headingDepths(english), headingDepths(reordered))).toBe(false)
  })

  test("a stale translation is dropped, so its page renders the English fallback", () => {
    const current = { stale: false, markdown: "# 指令" }
    const stale = { stale: true, markdown: "# 指令" }
    expect(currentTranslation(current)).toBe(current)
    expect(currentTranslation(stale)).toBeUndefined()
    expect(currentTranslation(undefined)).toBeUndefined()
  })
})
