import { expect, test } from "bun:test"
import en from "./i18n/en"
import { accessSummary, ADVANCED_ENTRIES, advancedOpen, verdict } from "./settings-view"

test("Advanced is closed until the person opens it, and a search hit inside it shows it open", () => {
  expect(advancedOpen(undefined, undefined)).toBe(false)
  expect(advancedOpen(false, undefined)).toBe(false)
  expect(advancedOpen(true, undefined)).toBe(true)
  // Every row that moved into Advanced opens it when settings search reveals it.
  ADVANCED_ENTRIES.forEach((entry) => expect(advancedOpen(false, entry)).toBe(true))
  // A hit on a row of the first screen leaves it closed.
  expect(advancedOpen(false, "settings-browser-links")).toBe(false)
  expect(advancedOpen(false, "settings-browser-import")).toBe(false)
  expect(advancedOpen(false, "settings-browser-extensions")).toBe(false)
})

test.each([
  ["supported", "Works here"],
  ["partial", "May not fully work here"],
  ["unsupported", "Probably won't work here"],
] as const)("an extension that is %s reads %p", (level, line) => {
  expect(en[verdict(level)]).toBe(line)
})

test.each([
  [["allSites", "cookies", "activity"], "Can read and change the pages you visit."],
  [["someSites", "clipboard"], "Can read and change pages on some sites."],
  [["cookies", "activity"], "Can see and change your sign-ins."],
  [["activity"], "Can see which pages you visit."],
  [["clipboard"], "Can read what you copy."],
  [[], "Doesn't ask to read your pages."],
] as const)("what %j can do is said in one sentence", (access, sentence) => {
  expect(en[accessSummary(access)]).toBe(sentence)
})
