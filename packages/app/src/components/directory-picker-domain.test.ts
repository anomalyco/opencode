import { expect, test } from "bun:test"
import {
  absoluteTreePath,
  activeTreeNavigation,
  advanceTreePreload,
  nextSuggestionIndex,
  nextTreeScrollTop,
  pickerTreeEntries,
  pickerSearchEntries,
  pickerFileSearchQuery,
  pickerMode,
  preloadTreeDirectories,
  selectedTreePath,
  treeEntries,
  treePathWithin,
  currentPickerSuggestions,
  createDirectorySearch,
  displayPickerPath,
  pickerParent,
  pickerRoot,
  pickerAbsoluteInput,
} from "./directory-picker-domain"

test("maps server directory entries into Pierre paths", () => {
  expect(
    treeEntries("src/", [
      { name: "components", type: "directory" },
      { name: "index.ts", type: "file" },
    ]),
  ).toEqual(["src/components/", "src/index.ts"])
})

test("maps Pierre paths back to the selected server root", () => {
  expect(absoluteTreePath("C:/Users/luke", "src/components/")).toBe("C:/Users/luke/src/components")
  expect(absoluteTreePath("C:/", "")).toBe("C:/")
  expect(absoluteTreePath("C:/", "README.md")).toBe("C:/README.md")
  expect(absoluteTreePath("/home/luke", "README.md")).toBe("/home/luke/README.md")
})

test("includes files only when the picker selects files", () => {
  const nodes = [
    { name: "components", type: "directory" as const },
    { name: "index.ts", type: "file" as const },
  ]
  expect(pickerTreeEntries("", nodes, "directory")).toEqual(["components/"])
  expect(pickerTreeEntries("", nodes, "file")).toEqual(["components/", "index.ts"])
})

test("includes files in file autocomplete while preserving directory navigation", () => {
  const nodes = [
    { name: "src", absolute: "/repo/src", type: "directory" as const },
    { name: "README.md", absolute: "/repo/README.md", type: "file" as const },
  ]
  expect(pickerSearchEntries(nodes, "directory")).toEqual([nodes[0]])
  expect(pickerSearchEntries(nodes, "file")).toEqual(nodes)
})

test("centralizes file and directory selection policy", () => {
  const file = pickerMode("file", "/repo")
  expect(file.includeFiles).toBeTrue()
  expect(file.selection("/repo/src", "index.ts")).toBe("src/index.ts")
  expect(file.selection("/repo", "src/")).toBeUndefined()
  expect(file.result("/repo", "src/index.ts")).toBe("src/index.ts")
  expect(file.selection("/tmp", "example.txt")).toBeUndefined()
  expect(file.navigation("/repo/src")).toBe("/repo/src")
  expect(file.navigation("/tmp")).toBeUndefined()

  const directory = pickerMode("directory")
  expect(directory.includeFiles).toBeFalse()
  expect(directory.selection("/repo", "src/")).toBe("/repo/src")
  expect(directory.selection("C:/Users/luke", "repos/")).toBe("C:\\Users\\luke\\repos")
  expect(directory.selection("//Server/Share", "repo/")).toBe("\\\\Server\\Share\\repo")
  expect(directory.navigation("/tmp")).toBe("/tmp")
  expect(directory.result("/repo", "")).toBe("/repo")
  expect(directory.result("C:/Users/luke", "")).toBe("C:\\Users\\luke")
  expect(directory.result("//Server/Share/repo", "")).toBe("\\\\Server\\Share\\repo")
  expect(directory.result("/repo", "", false)).toBeUndefined()
})

test("accepts mutations only from the active navigation", () => {
  expect(activeTreeNavigation(3, 3)).toBeTrue()
  expect(activeTreeNavigation(2, 3)).toBeFalse()
})

test("preserves POSIX case while matching Windows drives case-insensitively", () => {
  expect(treePathWithin("/repo", "/Repo")).toBeFalse()
  expect(treePathWithin("C:/Repo", "c:/repo/src")).toBeTrue()
  expect(treePathWithin("//Server/Share/Repo", "//server/share/repo/src")).toBeTrue()
  expect(pickerMode("file", "//Server/Share/Repo").selection("//server/share/repo/src", "file.ts")).toBe("src/file.ts")
  expect(treePathWithin("/repo", "/repo/../tmp")).toBeFalse()
  expect(treePathWithin("/", "/src")).toBeTrue()
  expect(pickerMode("file", "C:/Repo").selection("c:/repo/src", "file.ts")).toBe("src/file.ts")
  expect(pickerMode("file", "C:/").selection("C:/", "file.ts")).toBe("file.ts")
})

test("displays paths using the selected server path format", () => {
  expect(displayPickerPath("C:/Users/luke/repos", "C:/Users/luke/repos", "C:/Users/luke")).toBe(
    "C:\\Users\\luke\\repos",
  )
  expect(displayPickerPath("C:/Users/luke/repos", "C:\\Users\\luke\\repos", "C:/Users/luke")).toBe(
    "C:\\Users\\luke\\repos",
  )
  expect(displayPickerPath("/home/luke/repos", "repos", "/home/luke")).toBe("~/repos")
  expect(displayPickerPath("/home/luke/repos", "~/repos", "/home/luke")).toBe("~/repos")
})

test("treats the server share prefix as the UNC root", () => {
  expect(pickerRoot("//Server/Share/repo/src")).toBe("//Server/Share")
  expect(pickerRoot("\\\\Server\\Share\\repo\\src")).toBe("//Server/Share")
  expect(pickerParent("//Server/Share")).toBe("//Server/Share")
  expect(pickerParent("//Server/Share/repo")).toBe("//Server/Share")
})

test("resolves relative input against the current picker root", () => {
  expect(pickerAbsoluteInput("src", "/home/luke", "/home/luke/repo")).toBe("/home/luke/repo/src")
  expect(pickerAbsoluteInput("../other", "/home/luke", "/home/luke/repo")).toBe("/home/luke/other")
  expect(pickerAbsoluteInput("~/.config", "/home/luke", "/home/luke/repo")).toBe("/home/luke/.config")
  expect(pickerAbsoluteInput("src", "C:/Users/luke", "C:/Users/luke/repo")).toBe("C:/Users/luke/repo/src")
})

test("exposes autocomplete results only for their source query", () => {
  const result = { query: "/repo/src", items: ["/repo/src/index.ts"] }
  expect(currentPickerSuggestions(result, "/repo/src")).toEqual(result.items)
  expect(currentPickerSuggestions(result, "/repo/test")).toEqual([])
})

test("scopes file autocomplete to the current browser root", () => {
  expect(pickerFileSearchQuery("/home/luke/repos", "/home/luke/repos/src/in", "/home/luke")).toBe("src/in")
  expect(pickerFileSearchQuery("/home/luke", "~/repos/op", "/home/luke")).toBe("repos/op")
})

test("resolves directory autocomplete from the current browser root", async () => {
  const directories: string[] = []
  const sdk = {
    client: {
      find: {
        files: (input: { directory: string }) => {
          directories.push(input.directory)
          return Promise.resolve({ data: [] })
        },
      },
    },
  } as unknown as Parameters<typeof createDirectorySearch>[0]["sdk"]
  let base = "/repo"
  const search = createDirectorySearch({ sdk, home: () => "/home/luke", base: () => base })

  await search("components")
  base = "/repo/src"
  await search("components")

  expect(directories).toEqual(["/repo", "/repo/src"])
})

test("identifies the next directory level to preload", () => {
  expect(
    preloadTreeDirectories("src/", [
      { name: "components", type: "directory" },
      { name: "index.ts", type: "file" },
      { name: "utils", type: "directory" },
    ]),
  ).toEqual(["src/components/", "src/utils/"])
})

test("advances preloading once for every expanded directory", () => {
  const advanced = new Set<string>()
  expect(advanceTreePreload(advanced, "")).toBeTrue()
  expect(advanceTreePreload(advanced, "")).toBeFalse()
  expect(advanceTreePreload(advanced, "repos/")).toBeTrue()
})

test("clamps bridged tree wheel scrolling", () => {
  expect(nextTreeScrollTop(100, 40, 500, 200)).toBe(140)
  expect(nextTreeScrollTop(10, -40, 500, 200)).toBe(0)
  expect(nextTreeScrollTop(290, 40, 500, 200)).toBe(300)
})

test("wraps autocomplete keyboard navigation", () => {
  expect(nextSuggestionIndex(-1, 1, 4)).toBe(0)
  expect(nextSuggestionIndex(3, 1, 4)).toBe(0)
  expect(nextSuggestionIndex(0, -1, 4)).toBe(3)
  expect(nextSuggestionIndex(0, 1, 0)).toBe(-1)
})

test("returns absolute directories and relative files", () => {
  expect(selectedTreePath("/home/luke/repo", "src/", "directory")).toBe("/home/luke/repo/src")
  expect(selectedTreePath("/home/luke/repo", "src/index.ts", "file")).toBe("src/index.ts")
  expect(selectedTreePath("/home/luke/repo/src", "index.ts", "file", "/home/luke/repo")).toBe("src/index.ts")
  expect(selectedTreePath("/home/luke/repo", "src/", "file")).toBeUndefined()
})
