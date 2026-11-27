import { afterEach, expect, test } from "bun:test"
import { DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { jumpList, jumpTask } from "./jump-list"
import { setNativeTranslations } from "./translations"

const program = "C:\\Program Files\\OpenCode\\OpenCode.exe"

const tasks = () => jumpList(program).flatMap((category) => category.items ?? [])

afterEach(() => setNativeTranslations({ locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }))

test("each task starts the app with a flag that a second instance reads back as that task", () => {
  const read = tasks().map((item) => [item.title, jumpTask([program, "--allow-file-access-from-files", item.args!])])
  expect(read).toEqual([
    ["New Session", "new-session"],
    ["New Window", "new-window"],
  ])
  expect(jumpTask([program, "opencode://open-project?directory=C:\\repo"])).toBeUndefined()
})

test("task titles follow the app language", () => {
  setNativeTranslations({
    locale: "de",
    messages: {
      ...DESKTOP_NATIVE_ENGLISH,
      "desktop.menu.newSession": "Neue Sitzung",
      "desktop.menu.newWindow": "Neues Fenster",
    },
  })
  expect(tasks().map((item) => item.title)).toEqual(["Neue Sitzung", "Neues Fenster"])
})
