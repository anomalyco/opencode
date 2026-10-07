import { expect, test } from "bun:test"
import { voiceDictionary, voiceEnglish } from "./voice"

test("voice controls use complete Korean phrases with matching placeholders", () => {
  const korean = voiceDictionary("ko")
  expect(Object.keys(korean)).toEqual(Object.keys(voiceEnglish))
  Object.keys(voiceEnglish).forEach((key) => {
    const english = voiceEnglish[key as keyof typeof voiceEnglish]
    const translated = korean[key as keyof typeof korean]
    // Model product names intentionally remain unchanged across locales.
    if (key !== "models.manage.qwen") expect(translated).not.toBe(english)
    expect(translated.match(/{{\w+}}/g) ?? []).toEqual(english.match(/{{\w+}}/g) ?? [])
  })
  expect(voiceDictionary("fr")).toBe(voiceEnglish)
})
