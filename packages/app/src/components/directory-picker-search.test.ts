import { expect, test } from "bun:test"
import { createDirectorySearch } from "./directory-picker-domain"

type ListRequest = { location?: { directory?: string }; path?: string }
type FindRequest = { location?: { directory?: string }; query: string; type?: string; limit?: number }
type DirectoryNode = { path: string; type: "directory" }

test("refreshes the current directory for consecutive empty queries", async () => {
  const requests: ListRequest[] = []
  let finds = 0
  const listings: DirectoryNode[][] = [
    [{ path: "alpha/", type: "directory" }],
    [{ path: "beta/", type: "directory" }],
  ]
  const sdk = {
    api: {
      file: {
        list: (input: ListRequest) => {
          requests.push(input)
          return Promise.resolve({ data: listings[requests.length - 1] ?? [] })
        },
        find: () => {
          finds++
          return Promise.resolve({ data: [] })
        },
      },
    },
  } as unknown as Parameters<typeof createDirectorySearch>[0]["sdk"]
  const search = createDirectorySearch({ sdk, home: () => "/home/luke", base: () => "/repo" })

  expect(await search("")).toEqual(["/repo/alpha"])
  expect(await search("")).toEqual(["/repo/beta"])
  expect(requests).toEqual([
    { location: { directory: "/repo" }, path: "" },
    { location: { directory: "/repo" }, path: "" },
  ])
  expect(finds).toBe(0)
})

test("refreshes the current directory when file.find remains empty", async () => {
  const finds: FindRequest[] = []
  const lists: ListRequest[] = []
  const listings: DirectoryNode[][] = [
    [{ path: "alpha-project/", type: "directory" }],
    [{ path: "beta-project/", type: "directory" }],
  ]
  const sdk = {
    api: {
      file: {
        find: (input: FindRequest) => {
          finds.push(input)
          return Promise.resolve({ data: [] })
        },
        list: (input: ListRequest) => {
          lists.push(input)
          return Promise.resolve({ data: listings[lists.length - 1] ?? [] })
        },
      },
    },
  } as unknown as Parameters<typeof createDirectorySearch>[0]["sdk"]
  const search = createDirectorySearch({ sdk, home: () => "/home/luke", base: () => "/repo" })

  expect(await search("project")).toEqual(["/repo/alpha-project"])
  expect(await search("project")).toEqual(["/repo/beta-project"])
  expect(finds).toEqual([
    { location: { directory: "/repo" }, query: "project", type: "directory", limit: 50 },
    { location: { directory: "/repo" }, query: "project", type: "directory", limit: 50 },
  ])
  expect(lists).toEqual([
    { location: { directory: "/repo" }, path: "" },
    { location: { directory: "/repo" }, path: "" },
  ])
})

test("deduplicates concurrent directory lists while keeping only the latest search result", async () => {
  const listing = Promise.withResolvers<{ data: DirectoryNode[] }>()
  const lists: ListRequest[] = []
  const sdk = {
    api: {
      file: {
        list: (input: ListRequest) => {
          lists.push(input)
          return listing.promise
        },
        find: () => Promise.resolve({ data: [] }),
      },
    },
  } as unknown as Parameters<typeof createDirectorySearch>[0]["sdk"]
  const search = createDirectorySearch({ sdk, home: () => "/home/luke", base: () => "/repo" })

  const old = search("")
  const latest = search("")
  expect(lists).toEqual([{ location: { directory: "/repo" }, path: "" }])

  listing.resolve({ data: [{ path: "alpha/", type: "directory" }] })
  expect(await latest).toEqual(["/repo/alpha"])
  expect(await old).toEqual([])
  expect(lists).toEqual([{ location: { directory: "/repo" }, path: "" }])
})
