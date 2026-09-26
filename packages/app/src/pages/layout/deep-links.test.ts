import { describe, expect, test } from "bun:test"
import { drainPendingDeepLinks, parseConnectionDeepLink, parseDeepLink, parseNewSessionDeepLink } from "./deep-links"

const link = (url: string, directory = "/repo with spaces/项目") =>
  `opencode://connect?${new URLSearchParams({ url, directory })}`

describe("local connection links", () => {
  test("preserves the selected directory and normalizes the origin", () => {
    expect(parseConnectionDeepLink(link("http://127.0.0.1:49036/"))).toEqual({
      url: "http://127.0.0.1:49036",
      directory: "/repo with spaces/项目",
    })
  })

  test("rejects remote, credential-bearing, non-origin and malformed requests", () => {
    for (const url of [
      "https://example.com",
      "http://127.0.0.1.example.com",
      "http://user:secret@localhost:49036",
      "file:///repo",
      "http://localhost:49036/path",
      "http://localhost:49036?token=fixture",
      "http://localhost:49036#fragment",
      "http://localhost:0",
      "invalid",
    ])
      expect(parseConnectionDeepLink(link(url))).toBeUndefined()
    for (const directory of ["", "relative", "/repo\nother", "/repo\0other"])
      expect(parseConnectionDeepLink(link("http://localhost:49036", directory))).toBeUndefined()
  })

  test("does not steal pending project links from the other handler", () => {
    const project = "opencode://open-project?directory=/repo"
    const connection = link("http://localhost:49036")
    const target = { __OPENCODE__: { deepLinks: [project, connection] } }
    expect(drainPendingDeepLinks(target)).toEqual([project])
    expect(drainPendingDeepLinks(target, "connection")).toEqual([connection])
    expect(drainPendingDeepLinks(target, "connection")).toEqual([])
    expect(parseDeepLink(project)).toBe("/repo")
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/repo&prompt=hello")).toEqual({
      directory: "/repo",
      prompt: "hello",
    })
  })
})
