// FORK: i18n 完整性测试 — 守门 zh / zht 是否覆盖 en 所有 key,防 i18n 漂移 2026-05-07
//
// 背景:zh.ts / zht.ts 用 `satisfies Partial<Record<Keys, string>>`,允许缺 key 不报编译错。
// 其他 14 种语言(ja/ko/ar/...)是上游 sync 来的,fallback en,这里不测。
// fork-only 自家维护的核心是 zh / zht 两本,**全字典 100% 覆盖**(2026-05-07 历史漂移补全后升级)。
//
// 当 fork 后续 feat 加新 key,或上游 sync 引入新 key,zh / zht 必须同步补 — 否则本测试 fail。
//
// **每次 sync 上游后必跑**:if 失败 → 立刻补译,不要积累漂移到下次 sync。

import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

const enKeys = Object.keys(en) as Array<keyof typeof en>

describe("i18n completeness — 全字典守门", () => {
  describe("zh.ts(简体中文)", () => {
    test("覆盖 en 所有 key(无缺失)", () => {
      const zhKeys = new Set(Object.keys(zh))
      const missing = enKeys.filter((k) => !zhKeys.has(k))
      expect(missing).toEqual([])
    })

    test("不含 en 没有的 key(无遗留 dead key)", () => {
      const enKeySet = new Set<string>(enKeys)
      const extra = Object.keys(zh).filter((k) => !enKeySet.has(k))
      expect(extra).toEqual([])
    })

    test("所有 value 非空字符串", () => {
      const empties: string[] = []
      for (const [k, v] of Object.entries(zh)) {
        if (typeof v !== "string" || v.trim() === "") empties.push(k)
      }
      expect(empties).toEqual([])
    })
  })

  describe("zht.ts(繁体中文)", () => {
    test("覆盖 en 所有 key(无缺失)", () => {
      const zhtKeys = new Set(Object.keys(zht))
      const missing = enKeys.filter((k) => !zhtKeys.has(k))
      expect(missing).toEqual([])
    })

    test("不含 en 没有的 key(无遗留 dead key)", () => {
      const enKeySet = new Set<string>(enKeys)
      const extra = Object.keys(zht).filter((k) => !enKeySet.has(k))
      expect(extra).toEqual([])
    })

    test("所有 value 非空字符串", () => {
      const empties: string[] = []
      for (const [k, v] of Object.entries(zht)) {
        if (typeof v !== "string" || v.trim() === "") empties.push(k)
      }
      expect(empties).toEqual([])
    })
  })

  describe("最近 feat 关键 key(回归保护)", () => {
    // md-context-menu-i18n feat(2026-05-07)加的 5 个 key:
    const requiredMenuKeys = [
      "fileViewer.menu.addToChat",
      "fileViewer.menu.copy",
      "fileViewer.menu.input.placeholder",
      "fileViewer.menu.input.shortcutHint",
      "fileViewer.menu.input.submit",
    ] as const

    // md-export-pdf-word feat 加的 4 个 key(实际名,不是我之前误的 nested ".title"):
    const requiredExportKeys = [
      "fileViewer.menu.exportDocx",
      "fileViewer.dialog.exportDocxTitle",
      "fileViewer.toast.exportDocxSuccess",
      "fileViewer.toast.exportDocxFail",
    ] as const

    const allRequired = [...requiredMenuKeys, ...requiredExportKeys]

    test("三本字典都含 md-context-menu-i18n + md-export-pdf-word 全部 key", () => {
      const dicts = [
        { name: "en", d: en as Record<string, string> },
        { name: "zh", d: zh as Record<string, string> },
        { name: "zht", d: zht as Record<string, string> },
      ]
      for (const { name, d } of dicts) {
        const missing = allRequired.filter((k) => !(k in d))
        expect({ dict: name, missing }).toEqual({ dict: name, missing: [] })
      }
    })

    test("shortcutHint 模板含 {{shortcut}} 占位符(三本字典)", () => {
      const en1 = (en as Record<string, string>)["fileViewer.menu.input.shortcutHint"]
      const zh1 = (zh as Record<string, string>)["fileViewer.menu.input.shortcutHint"]
      const zht1 = (zht as Record<string, string>)["fileViewer.menu.input.shortcutHint"]
      expect(en1).toContain("{{shortcut}}")
      expect(zh1).toContain("{{shortcut}}")
      expect(zht1).toContain("{{shortcut}}")
    })
  })
})
