import { expect, test } from "bun:test"
import { defaultSpellcheckLanguages } from "./spellcheck-languages"

// A slice of Electron 44's Linux and Windows list, including aliases such as de and de-DE.
const available = ["de", "de-DE", "en", "en-AU", "en-GB", "en-US", "es", "es-MX", "fr", "fr-FR", "pt", "pt-BR"]

test.each([
  [["de-DE"], ["de-DE", "en-US"]],
  [
    ["de-DE", "de", "en-US", "en"],
    ["de-DE", "en-US"],
  ],
  [
    ["de-AT", "fr-CA"],
    ["de", "fr", "en-US"],
  ],
  [
    ["en-GB", "de-DE"],
    ["en-GB", "de-DE"],
  ],
  [["en-NZ"], ["en"]],
  [
    ["es-MX", "es-ES"],
    ["es-MX", "en-US"],
  ],
  [["pt-AO"], ["pt", "en-US"]],
  [["DE-de"], ["de-DE", "en-US"]],
  [["ja-JP"], ["en-US"]],
  [[], ["en-US"]],
])("system languages %p use dictionaries %p", (preferred, languages) => {
  expect(defaultSpellcheckLanguages(available, preferred)).toEqual(languages)
})
