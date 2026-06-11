import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as uk } from "./uk"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { dict as tr } from "./tr"

const locales = [ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, uk, th, tr, zh, zht]
const keys = ["command.session.previous.unseen", "command.session.next.unseen"] as const
const presetKeys = [
  "presets.title",
  "presets.manage",
  "presets.count",
  "presets.empty",
  "presets.empty.hint",
  "presets.add",
  "presets.name",
  "presets.content",
  "presets.content.placeholder",
  "presets.moveUp",
  "presets.moveDown",
  "presets.edit",
  "presets.delete",
  "presets.variables.title",
  "presets.variables.next",
  "presets.variables.insert",
] as const

// Keys that may have the same translation as English in some languages
const allowedSameAsEnglish = new Set(["presets.name"])

describe("i18n parity", () => {
  test("non-English locales translate targeted unseen session keys", () => {
    for (const locale of locales) {
      for (const key of keys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })

  test("non-English locales translate all preset keys", () => {
    for (const locale of locales) {
      for (const key of presetKeys) {
        expect(locale[key]).toBeDefined()
        if (!allowedSameAsEnglish.has(key)) {
          expect(locale[key]).not.toBe(en[key])
        }
      }
    }
  })
})
