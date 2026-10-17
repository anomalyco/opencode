import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as zht } from "./zht"
import { dict as zh } from "./zh"

// Non-English dictionaries are intentionally partial: a key they omit falls back to English at
// runtime. These tests therefore do not enforce full parity. They protect the keys that *are*
// translated (placeholders, unknown keys, zh/zht symmetry) and ratchet the number of missing keys
// so coverage can only move in one direction.

// Baseline as of 2026-09-22; decrease when translations are added, never increase without new en keys.
const APP_MISSING_BASELINE = 418

const english: Record<string, string> = en

const locales: Array<{ name: string; messages: Record<string, string> }> = [
  { name: "zh", messages: zh },
  { name: "zht", messages: zht },
]

/** Collects the unique `{{placeholder}}` names used by a message, sorted for stable comparison. */
function placeholders(message: string) {
  return [...new Set(Array.from(message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]))].sort()
}

describe("i18n dictionary parity", () => {
  for (const locale of locales) {
    describe(locale.name, () => {
      test("uses the same placeholders as the English dictionary", () => {
        const mismatches: string[] = []

        for (const [key, message] of Object.entries(locale.messages)) {
          const source = english[key]
          if (source === undefined) continue // reported by the unknown key test below

          const expected = placeholders(source)
          const actual = placeholders(message)
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            mismatches.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
          }
        }

        expect(mismatches).toEqual([])
      })

      test("only references keys that exist in the English dictionary", () => {
        const unknown = Object.keys(locale.messages)
          .filter((key) => !Object.hasOwn(english, key))
          .sort()

        expect(unknown).toEqual([])
      })

      test("keeps English key coverage within the accepted baseline", () => {
        const missing = Object.keys(english).filter((key) => !Object.hasOwn(locale.messages, key))

        expect(missing.length).toBeLessThanOrEqual(APP_MISSING_BASELINE)
      })
    })
  }

  test("translates the same keys in zh and zht", () => {
    const zhKeys = new Set(Object.keys(zh))
    const zhtKeys = new Set(Object.keys(zht))

    expect({
      onlyInZh: [...zhKeys].filter((key) => !zhtKeys.has(key)).sort(),
      onlyInZht: [...zhtKeys].filter((key) => !zhKeys.has(key)).sort(),
    }).toEqual({ onlyInZh: [], onlyInZht: [] })
  })
})
