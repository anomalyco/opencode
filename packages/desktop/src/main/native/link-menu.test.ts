import { afterEach, expect, test } from "bun:test"
import { DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { linkMenuItems } from "./link-menu"
import { setNativeTranslations } from "./translations"

afterEach(() => setNativeTranslations({ locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }))

test.each([
  ["https://opencode.ai/docs", "https://opencode.ai/docs"],
  ["HTTPS://OpenCode.AI", "https://opencode.ai/"],
  ["http://localhost:4096/session", "http://localhost:4096/session"],
])("a right-clicked %s link offers to open it in the browser", (linkURL, target) => {
  const opened: string[] = []
  const [item, separator] = linkMenuItems(linkURL, (url) => opened.push(url))

  expect(item.label).toBe(DESKTOP_NATIVE_ENGLISH["desktop.contextMenu.openLink"])
  expect(separator.type).toBe("separator")

  // SAFETY: The item is a plain click handler that ignores the Electron menu arguments.
  const click = item.click as () => void
  click()
  expect(opened).toEqual([target])
})

test.each([
  undefined,
  "",
  "file:///etc/hosts",
  "opencode://open-project?directory=%2Frepo",
  "mailto:hello@opencode.ai",
  "javascript:alert(1)",
])("a right-clicked %p link adds no browser item", (linkURL) => {
  expect(linkMenuItems(linkURL, () => {})).toEqual([])
})

test("the browser item follows the app language", () => {
  setNativeTranslations({
    locale: "de",
    messages: { ...DESKTOP_NATIVE_ENGLISH, "desktop.contextMenu.openLink": "Link im externen Browser öffnen" },
  })
  expect(linkMenuItems("https://opencode.ai", () => {})[0].label).toBe("Link im externen Browser öffnen")
})
