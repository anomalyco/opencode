import { afterEach, describe, expect, test } from "bun:test"
import { DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { jumpList, jumpTask } from "./jump-list"
import { setNativeTranslations } from "./translations"

const program = "C:\\Program Files\\OpenCode\\OpenCode.exe"

afterEach(() => {
  setNativeTranslations({ locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } })
})

describe("jump list", () => {
  test("each task starts the app with a flag a second instance reads back as that task", () => {
    const items = jumpList(program).flatMap((category) => category.items ?? [])

    const started = items.map((item) => ({
      title: item.title,
      program: item.program,
      task: jumpTask([program, "--allow-file-access-from-files", ...(item.args?.split(" ") ?? [])]),
    }))

    expect(started).toEqual([
      { title: "New Session", program, task: "new-session" },
      { title: "New Window", program, task: "new-window" },
    ])
  })

  test("reads no task from a plain launch or a deep link", () => {
    expect(jumpTask([program])).toBeUndefined()
    expect(jumpTask([program, "opencode://open-project?directory=C:\\repo"])).toBeUndefined()
  })

  test("tasks follow the app language", () => {
    setNativeTranslations({
      locale: "de",
      messages: {
        ...DESKTOP_NATIVE_ENGLISH,
        "desktop.menu.newSession": "Neue Sitzung",
        "desktop.menu.newWindow": "Neues Fenster",
      },
    })

    const titles = jumpList(program)
      .flatMap((category) => category.items ?? [])
      .map((item) => item.title)

    expect(titles).toEqual(["Neue Sitzung", "Neues Fenster"])
  })
})
