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

const ALLOW_LIST = ["OpenCode", "Wayland", "X11", "Linux", "Ctrl"] as const

const enDict = en as Record<string, string>
const esDict = es as Record<string, string>

const generalKeys = Object.keys(enDict).filter((key) => key.startsWith("settings.general."))

function isAllowListed(value: string): boolean {
  return ALLOW_LIST.some((term) => term === value)
}

describe("i18n parity", () => {
  test("non-English locales translate targeted unseen session keys", () => {
    for (const locale of locales) {
      for (const key of keys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })

  test("Spanish locale defines and translates all General settings keys", () => {
    for (const key of generalKeys) {
      expect(esDict[key]).toBeDefined()
      const englishValue = enDict[key]
      if (!isAllowListed(englishValue)) {
        expect(esDict[key]).not.toBe(englishValue)
      }
    }
  })
})
