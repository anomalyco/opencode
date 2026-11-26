import { afterEach, expect, test } from "bun:test"
import { DESKTOP_NATIVE_ENGLISH } from "@opencode/app/i18n/desktop-native"
import { jumpList, jumpTask, onRecentProjects, setRecentProjects } from "./jump-list"
import { setNativeTranslations } from "./translations"

const program = "C:\\Program Files\\OpenCode\\OpenCode.exe"

const tasks = () => jumpList(program).flatMap((category) => category.items ?? [])

afterEach(() => {
  setNativeTranslations({ locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } })
  setRecentProjects([])
})

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

test("recent projects come first, each opening its folder with an opencode://open-project link", () => {
  const categories = jumpList(program, [{ name: "acme-web", directory: "C:\\demo\\acme web" }])
  expect(categories.map((category) => category.type)).toEqual(["custom", "tasks"])
  expect(categories[0]?.name).toBe("Recent Projects")
  const item = categories[0]?.items?.[0]
  expect(item?.title).toBe("acme-web")
  expect(item?.description).toBe("C:\\demo\\acme web")
  const url = new URL(item!.args!)
  expect([url.protocol, url.hostname, url.searchParams.get("directory")]).toEqual(["opencode:", "open-project", "C:\\demo\\acme web"])
  expect(item!.args).not.toContain(" ")
  expect(jumpTask([program, item!.args!])).toBeUndefined()
})

test("an entry the user removed is left out, and an empty category with it", () => {
  const recent = [
    { name: "a", directory: "C:\\a" },
    { name: "b", directory: "C:\\b" },
  ]

  const removed = new Set([jumpList(program, recent)[0]!.items![0]!.args!])

  expect(jumpList(program, recent, removed)[0]?.items?.map((item) => item.title)).toEqual(["b"])
  expect(jumpList(program, recent.slice(0, 1), removed).map((category) => category.type)).toEqual(["tasks"])
})

test("the recent list keeps five and tells its listeners only when it changes", () => {
  let calls = 0
  const stop = onRecentProjects(() => calls++)
  const seven = Array.from({ length: 7 }, (_, i) => ({ name: `p${i}`, directory: `C:\\p${i}` }))
  setRecentProjects(seven)
  setRecentProjects(seven.slice(0, 5))
  expect(calls).toBe(1)
  expect(jumpList(program)[0]?.items?.map((item) => item.title)).toEqual(["p0", "p1", "p2", "p3", "p4"])
  stop()
})