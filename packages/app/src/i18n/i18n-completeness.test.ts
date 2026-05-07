// FORK: i18n 完整性测试 — 守门 zh / zht 是否覆盖 en 所有 key,防 i18n 漂移 2026-05-07
//
// 背景:zh.ts / zht.ts 用 `satisfies Partial<Record<Keys, string>>`,允许缺 key 不报编译错。
// 其他 14 种语言(ja/ko/ar/...)是上游 sync 来的,fallback en,这里不测。
// fork-only 自家维护的核心是 zh / zht 两本。
//
// 关键 namespace 100% 覆盖(强守门):
//   - fileViewer.*  — 文件查看器,fork 重灾区
//   - common.*      — 公共词,改动频繁
// 其他 namespace 不强制 — 历史 sync 残留漂移属于另一个 feat 范围,不在本测试守门范围。
//
// 当 fork 后续 feat 加新 key 到这两个 namespace 时,zh / zht 必须同步补 — 否则本测试 fail。

import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

const enKeys = Object.keys(en) as Array<keyof typeof en>

// 关键 namespace 前缀(必须 100% 覆盖 zh / zht)
const CRITICAL_NAMESPACES = ["fileViewer.", "common."] as const
const isCritical = (key: string) => CRITICAL_NAMESPACES.some((ns) => key.startsWith(ns))

const enCriticalKeys = enKeys.filter((k) => isCritical(k as string)) as string[]

describe("i18n completeness — 关键 namespace 守门", () => {
  test("CRITICAL_NAMESPACES 实际命中 en key(防止 namespace 列表过期)", () => {
    expect(enCriticalKeys.length).toBeGreaterThan(0)
  })

  describe("zh.ts(简体中文)", () => {
    test("关键 namespace 全覆盖", () => {
      const zhKeys = new Set(Object.keys(zh))
      const missing = enCriticalKeys.filter((k) => !zhKeys.has(k))
      expect(missing).toEqual([])
    })

    test("关键 namespace 下所有 value 非空", () => {
      const empties: string[] = []
      for (const k of enCriticalKeys) {
        const v = (zh as Record<string, string>)[k]
        if (v !== undefined && (typeof v !== "string" || v.trim() === "")) empties.push(k)
      }
      expect(empties).toEqual([])
    })
  })

  describe("zht.ts(繁体中文)", () => {
    test("关键 namespace 全覆盖", () => {
      const zhtKeys = new Set(Object.keys(zht))
      const missing = enCriticalKeys.filter((k) => !zhtKeys.has(k))
      expect(missing).toEqual([])
    })

    test("关键 namespace 下所有 value 非空", () => {
      const empties: string[] = []
      for (const k of enCriticalKeys) {
        const v = (zht as Record<string, string>)[k]
        if (v !== undefined && (typeof v !== "string" || v.trim() === "")) empties.push(k)
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
