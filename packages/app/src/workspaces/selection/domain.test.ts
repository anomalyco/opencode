import { expect, test } from "bun:test"
import {
  absoluteTreePath,
  activeTreeNavigation,
  advanceTreePreload,
  nextSuggestionIndex,
  nextTreeScrollTop,
  pickerFileSearchQuery,
  pickerMode,
  preloadTreeDirectories,
  selectedTreePath,
  treeEntries,
  treePathWithin,
  currentPickerSuggestions,
  createDirectorySearch,
  createPriorityTaskQueue,
  listPickerDirectory,
  displayPickerPath,
  pickerParent,
  pickerRoot,
  pickerAbsoluteInput,
} from "./domain"

type Sdk = Parameters<typeof listPickerDirectory>[0]

// The picker only reads `api.file.find` and `api.file.list`.
const sdk = (file: { find?: (input: never) => Promise<unknown>; list?: (input: never) => Promise<unknown> }) =>
  ({ api: { file } }) as unknown as Sdk

test("maps server directory entries into Pierre paths", () => {
  expect(
    treeEntries("src/", [
      { name: "components", type: "directory" },
      { name: "index.ts", type: "file" },
    ]),
  ).toEqual(["src/components/", "src/index.ts"])
})

test.each([
  ["C:/Users/luke", "src/components/", "C:/Users/luke/src/components"],
  ["C:/", "", "C:/"],
  ["C:/", "README.md", "C:/README.md"],
  ["/home/luke", "README.md", "/home/luke/README.md"],
])("maps the Pierre path %p under %p back to %p", (root, path, expected) => {
  expect(absoluteTreePath(root, path)).toBe(expected)
})

test("centralizes file and directory selection policy", () => {
  const nodes = [
    { name: "components", type: "directory" as const },
    { name: "index.ts", type: "file" as const },
  ]
  expect(pickerMode("file", "/repo").entries("src/", nodes)).toEqual(["src/components/", "src/index.ts"])
  expect(pickerMode("directory").entries("src/", nodes)).toEqual(["src/components/"])

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

  expect(selectedTreePath("/home/luke/repo", "src/", "directory")).toBe("/home/luke/repo/src")
  expect(selectedTreePath("/home/luke/repo", "src/index.ts", "file")).toBe("src/index.ts")
  expect(selectedTreePath("/home/luke/repo/src", "index.ts", "file", "/home/luke/repo")).toBe("src/index.ts")
  expect(selectedTreePath("/home/luke/repo", "src/", "file")).toBeUndefined()
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

test.each([
  [
    "display",
    displayPickerPath("C:/Users/luke/repos", "C:/Users/luke/repos", "C:/Users/luke"),
    "C:\\Users\\luke\\repos",
  ],
  [
    "display",
    displayPickerPath("C:/Users/luke/repos", "C:\\Users\\luke\\repos", "C:/Users/luke"),
    "C:\\Users\\luke\\repos",
  ],
  ["display", displayPickerPath("/home/luke/repos", "repos", "/home/luke"), "~/repos"],
  ["display", displayPickerPath("/home/luke/repos", "~/repos", "/home/luke"), "~/repos"],
  ["UNC root", pickerRoot("//Server/Share/repo/src"), "//Server/Share"],
  ["UNC root", pickerRoot("\\\\Server\\Share\\repo\\src"), "//Server/Share"],
  ["UNC parent", pickerParent("//Server/Share"), "//Server/Share"],
  ["UNC parent", pickerParent("//Server/Share/repo"), "//Server/Share"],
  ["relative input", pickerAbsoluteInput("src", "/home/luke", "/home/luke/repo"), "/home/luke/repo/src"],
  ["relative input", pickerAbsoluteInput("../other", "/home/luke", "/home/luke/repo"), "/home/luke/other"],
  ["relative input", pickerAbsoluteInput("~/.config", "/home/luke", "/home/luke/repo"), "/home/luke/.config"],
  ["relative input", pickerAbsoluteInput("src", "C:/Users/luke", "C:/Users/luke/repo"), "C:/Users/luke/repo/src"],
  ["file search", pickerFileSearchQuery("/home/luke/repos", "/home/luke/repos/src/in", "/home/luke"), "src/in"],
  ["file search", pickerFileSearchQuery("/home/luke", "~/repos/op", "/home/luke"), "repos/op"],
])("uses the selected server path format for %s: %p", (_name, actual, expected) => {
  expect(actual).toBe(expected)
})

test("exposes autocomplete results only for their source query", () => {
  const result = { query: "/repo/src", items: ["/repo/src/index.ts"] }
  expect(currentPickerSuggestions(result, "/repo/src")).toEqual(result.items)
  expect(currentPickerSuggestions(result, "/repo/test")).toEqual([])
})

test("resolves directory autocomplete from the browser root without changing location", async () => {
  const calls: unknown[] = []
  const location = { directory: "/repo", workspace: "workspace_1" }
  const api = sdk({
    find: (input) => {
      calls.push(input)
      return Promise.resolve({ location, data: [{ path: "src/components/", type: "directory" }] })
    },
    list: () => Promise.resolve({ data: [] }),
  })
  let base = "/repo"
  const search = createDirectorySearch({
    sdk: api,
    home: () => "/home/luke",
    base: () => base,
    location: () => location,
  })

  expect(await search("components")).toEqual(["/repo/src/components"])
  base = "/repo/src"
  expect(await search("components")).toEqual(["/repo/src/components"])

  expect(calls).toEqual([
    { location, query: "components", type: "directory", limit: 50 },
    { location, query: "src/components", type: "directory", limit: 50 },
  ])
})

test("lists absolute parents and preloads siblings through a stable workspace", async () => {
  const calls: unknown[] = []
  const location = { directory: "/repo/current", workspace: "workspace_1" }
  const api = sdk({
    list: async (input: { path?: string }) => {
      calls.push(input)
      return {
        location,
        data:
          input.path === "/repo"
            ? [
                { path: "./", type: "directory" },
                { path: "../sibling/", type: "directory" },
              ]
            : [{ path: "../sibling/src/", type: "directory" }],
      }
    },
  })
  expect(await listPickerDirectory(api, location, "/repo")).toEqual([
    { name: "current", absolute: "/repo/current", type: "directory" },
    { name: "sibling", absolute: "/repo/sibling", type: "directory" },
  ])
  expect(await listPickerDirectory(api, location, "/repo/sibling")).toEqual([
    { name: "src", absolute: "/repo/sibling/src", type: "directory" },
  ])
  expect(calls).toEqual([
    { location, path: "/repo" },
    { location, path: "/repo/sibling" },
  ])
})

test("uses listings for typed searches outside the current location", async () => {
  const calls: unknown[] = []
  const location = { directory: "/repo/current", workspace: "workspace_1" }
  const api = sdk({
    find: () => Promise.reject(new Error("outside searches must not change location")),
    list: async (input) => {
      calls.push(input)
      return { location, data: [{ path: "../sibling/", type: "directory" }] }
    },
  })
  const search = createDirectorySearch({
    sdk: api,
    home: () => "/home/luke",
    base: () => "/repo",
    location: () => location,
  })
  expect(await search("sib")).toEqual(["/repo/sibling"])
  expect(calls).toEqual([{ location, path: "/repo" }])
})

test("keeps literal tilde directory names in server listing and search results", async () => {
  const location = { directory: "/repo" }
  const api = sdk({
    list: async () => ({ location, data: [{ path: "~/", type: "directory" }] }),
    find: async () => ({ location, data: [{ path: "~/nested/", type: "directory" }] }),
  })
  expect(await listPickerDirectory(api, location, "/repo")).toEqual([
    { name: "~", absolute: "/repo/~", type: "directory" },
  ])
  const search = createDirectorySearch({
    sdk: api,
    home: () => "/home/user",
    base: () => "/repo",
    location: () => location,
  })
  expect(await search("nested")).toEqual(["/repo/~/nested"])
})

test("discards stale typed results without changing the request location", async () => {
  const location = { directory: "/repo" }
  const pending = Promise.withResolvers<{
    location: typeof location
    data: Array<{ path: string; type: "directory" }>
  }>()
  const calls: unknown[] = []
  const api = sdk({
    find: async (input: { query: string }) => {
      calls.push(input)
      if (input.query === "old") return pending.promise
      return { location, data: [{ path: "new/", type: "directory" }] }
    },
  })
  const search = createDirectorySearch({
    sdk: api,
    home: () => "/home/luke",
    base: () => "/repo",
    location: () => location,
  })
  const stale = search("old")
  expect(await search("new")).toEqual(["/repo/new"])
  pending.resolve({ location, data: [{ path: "old/", type: "directory" }] })
  expect(await stale).toEqual([])
  expect(calls).toEqual([
    { location, query: "old", type: "directory", limit: 50 },
    { location, query: "new", type: "directory", limit: 50 },
  ])
})

test("maps server-native drive and share paths without rebasing the location", async () => {
  const calls: unknown[] = []
  const api = sdk({
    list: async (input: { location: { directory: string }; path: string }) => {
      calls.push(input)
      return { location: input.location, data: [{ path: "../sibling/", type: "directory" }] }
    },
  })
  const drive = { directory: "C:\\Repo\\Current", workspace: "workspace_1" }
  expect(await listPickerDirectory(api, drive, "c:/repo")).toEqual([
    { name: "sibling", type: "directory", absolute: "C:/Repo/sibling" },
  ])
  const share = { directory: "\\\\Server\\Share\\Current", workspace: "workspace_2" }
  expect(await listPickerDirectory(api, share, "//server/share")).toEqual([
    { name: "sibling", type: "directory", absolute: "//Server/Share/sibling" },
  ])
  expect(calls).toEqual([
    { location: drive, path: "c:/repo" },
    { location: share, path: "//server/share" },
  ])
})

const home = { directory: "/home/luke" }
const projects = Array.from({ length: 60 }, (_, index) => ({ path: `project-${index}/`, type: "directory" as const }))

const fallbacks: {
  name: string
  query: string
  find: () => Promise<unknown>
  list: () => Promise<unknown>
  expected: string[]
  listed: string[]
}[] = [
  {
    name: "keeps indexed results for servers that support empty search",
    query: "",
    find: () => Promise.resolve({ location: home, data: [{ path: "projects/", type: "directory" }] }),
    list: () => Promise.reject(new Error("listing should not run when search returns results")),
    expected: ["/home/luke/projects"],
    listed: [],
  },
  {
    name: "lists the default directory when empty search is unsupported",
    query: "",
    find: () => Promise.resolve({ data: [] }),
    list: () => Promise.resolve({ location: home, data: [...projects, { path: "README.md", type: "file" }] }),
    expected: projects.map((item) => `/home/luke/${item.path.slice(0, -1)}`),
    listed: ["/home/luke"],
  },
  {
    name: "matches the default directory listing when typed search is unsupported",
    query: "documents",
    find: () => Promise.resolve({ data: [] }),
    list: () =>
      Promise.resolve({
        location: home,
        data: [
          { path: "Documents/", type: "directory" },
          { path: "Downloads/", type: "directory" },
        ],
      }),
    expected: ["/home/luke/Documents"],
    listed: ["/home/luke"],
  },
]

test.each(fallbacks)("directory search $name", async (row) => {
  const listed: unknown[] = []
  const api = sdk({
    find: row.find,
    list: (input: { location?: { directory?: string } }) => {
      listed.push(input.location?.directory)
      return row.list()
    },
  })
  const search = createDirectorySearch({
    sdk: api,
    home: () => "/home/luke",
    base: () => "/home/luke",
    location: () => home,
  })

  expect(await search(row.query)).toEqual(row.expected)
  expect(listed).toEqual(row.listed)
})

test("searches from an absolute root without a default base", async () => {
  const location = { directory: "/" }
  const directories: string[] = []
  const api = sdk({
    list: (input: { location?: { directory?: string } }) => {
      directories.push(input.location?.directory ?? "")
      return Promise.resolve({
        location,
        data: [
          { path: "Users/", type: "directory" },
          { path: "tmp/", type: "directory" },
        ],
      })
    },
  })
  const search = createDirectorySearch({ sdk: api, home: () => "", base: () => undefined, location: () => location })

  expect(await search("/")).toEqual(["/Users", "/tmp"])
  expect(directories).toEqual(["/"])
})

test("identifies the next directory level to preload once for every expanded directory", () => {
  expect(
    preloadTreeDirectories("src/", [
      { name: "components", type: "directory" },
      { name: "index.ts", type: "file" },
      { name: "utils", type: "directory" },
    ]),
  ).toEqual(["src/components/", "src/utils/"])

  const advanced = new Set<string>()
  expect(advanceTreePreload(advanced, "")).toBeTrue()
  expect(advanceTreePreload(advanced, "")).toBeFalse()
  expect(advanceTreePreload(advanced, "repos/")).toBeTrue()
})

test("limits background tasks and prioritizes newly requested work", async () => {
  const queue = createPriorityTaskQueue<void>(2)
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const started: string[] = []
  let active = 0
  let maximum = 0
  const task = (name: string, blocker?: Promise<void>) => async () => {
    started.push(name)
    active++
    maximum = Math.max(maximum, active)
    await blocker
    active--
  }

  const running = [
    queue.schedule("first", "background", task("first", first.promise)),
    queue.schedule("second", "background", task("second", second.promise)),
    queue.schedule("preload", "background", task("preload")),
    queue.schedule("opened", "user", task("opened")),
  ]
  await Promise.resolve()
  expect(started).toEqual(["first", "second"])

  first.resolve()
  await running[0]
  await Promise.resolve()
  expect(started).toEqual(["first", "second", "opened"])

  second.resolve()
  await Promise.all(running)
  expect(started).toEqual(["first", "second", "opened", "preload"])
  expect(maximum).toBe(2)
})

test.each([
  [3, 3, true],
  [2, 3, false],
])("a tree mutation from navigation %p applies during navigation %p: %p", (request, current, expected) => {
  expect(activeTreeNavigation(request, current)).toBe(expected)
})

test.each([
  [100, 40, 140],
  [10, -40, 0],
  [290, 40, 300],
])("bridged wheel scrolling from %p by %p clamps to %p", (current, delta, expected) => {
  expect(nextTreeScrollTop(current, delta, 500, 200)).toBe(expected)
})

test("wraps autocomplete keyboard navigation", () => {
  expect(nextSuggestionIndex(-1, 1, 4)).toBe(0)
  expect(nextSuggestionIndex(3, 1, 4)).toBe(0)
  expect(nextSuggestionIndex(0, -1, 4)).toBe(3)
  expect(nextSuggestionIndex(0, 1, 0)).toBe(-1)
})
