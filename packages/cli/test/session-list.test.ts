import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode, type LocationGetOutput, type SessionInfo } from "@opencode/client/promise"
import { Option } from "effect"
import { EOL } from "node:os"
import { formatList, listSessions } from "../src/commands/handlers/session/list"

function location(directory: string): LocationGetOutput {
  return { directory, project: { id: "project-current", directory, canonical: directory } }
}

function page(data: SessionInfo[] = [], next?: string) {
  return { data, cursor: next === undefined ? {} : { next } }
}

function session(id: string, title: string, directory: string): SessionInfo {
  return {
    id,
    projectID: "project",
    title,
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
}

afterEach(() => mock.restore())

describe("session list", () => {
  test("scopes the default listing to the current project", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const get = spyOn(client.location, "get").mockResolvedValue(location("/work"))
    const list = spyOn(client.session, "list").mockResolvedValue(page())

    await listSessions(client, { all: false, maxCount: Option.none(), noLimit: false }, "/work")

    expect(get).toHaveBeenCalledWith({ location: { directory: "/work" } }, {})
    expect(list.mock.calls[0]![0]).toEqual({
      project: "project-current",
      parentID: null,
      order: "desc",
      limit: 100,
    })
  })

  test("--all skips the location lookup and omits the project filter", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const get = spyOn(client.location, "get").mockResolvedValue(location("/work"))
    const list = spyOn(client.session, "list").mockResolvedValue(page())

    await listSessions(client, { all: true, maxCount: Option.none(), noLimit: false }, "/work")

    expect(get).not.toHaveBeenCalled()
    const query = list.mock.calls[0]![0]!
    // `project` must be absent, not undefined: the store filters whenever the key is present.
    expect(Object.hasOwn(query, "project")).toBe(false)
    expect(query).toEqual({ parentID: null, order: "desc", limit: 100 })
  })

  test("--max-count caps the page", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/work"))
    const list = spyOn(client.session, "list").mockResolvedValue(page())

    await listSessions(client, { all: false, maxCount: Option.some(5), noLimit: false }, "/work")

    expect(list.mock.calls[0]![0]!.limit).toBe(5)
  })

  test("follows the cursor until --max-count rows are collected", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const get = spyOn(client.location, "get").mockResolvedValue(location("/work"))
    const list = spyOn(client.session, "list")
      .mockResolvedValueOnce(page([session("ses_a", "A", "/work")], "cursor-1"))
      .mockResolvedValueOnce(page([session("ses_b", "B", "/work")]))

    const sessions = await listSessions(client, { all: false, maxCount: Option.some(5), noLimit: false }, "/work")

    expect(sessions.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(get).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[1]![0]).toEqual({
      project: "project-current",
      parentID: null,
      order: "desc",
      limit: 4,
      cursor: "cursor-1",
    })
  })

  test("--no-limit walks every page", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/work"))
    const list = spyOn(client.session, "list")
      .mockResolvedValueOnce(page([session("ses_a", "A", "/work")], "cursor-1"))
      .mockResolvedValueOnce(page([session("ses_b", "B", "/work")]))

    const sessions = await listSessions(client, { all: false, maxCount: Option.none(), noLimit: true }, "/work")

    expect(sessions.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(list.mock.calls[1]![0]!.cursor).toBe("cursor-1")
    expect(list.mock.calls[1]![0]!.limit).toBe(100)
  })

  test("stops if the server repeats a cursor", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/work"))
    const list = spyOn(client.session, "list")
      .mockResolvedValueOnce(page([session("ses_a", "A", "/work")], "cursor-1"))
      .mockResolvedValueOnce(page([session("ses_b", "B", "/work")], "cursor-1"))

    const sessions = await listSessions(client, { all: false, maxCount: Option.none(), noLimit: true }, "/work")

    expect(sessions.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(list).toHaveBeenCalledTimes(2)
  })

  test("--no-limit cannot be combined with --max-count", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })

    await expect(
      listSessions(client, { all: false, maxCount: Option.some(5), noLimit: true }, "/work"),
    ).rejects.toThrow("--no-limit cannot be combined with --max-count")
  })
})

describe("session list table", () => {
  const sessions = [
    session("ses_a", "Fix theme preview lag", "/work/opencode"),
    session("ses_b", "GEP unmerge nuw", "/work/llvm-project"),
  ]

  test("keeps the default columns unchanged", () => {
    const rows = formatList(sessions, false).split(EOL)

    expect(rows.map((row) => row.split("\t").length)).toEqual([3, 3])
    expect(rows[0]!.split("\t")[0]).toBe("ses_a")
  })

  test("--all adds the session's directory", () => {
    const rows = formatList(sessions, true).split(EOL)

    expect(rows[0]!.split("\t")).toEqual(["ses_a", "Fix theme preview lag", expect.any(String), "/work/opencode"])
    expect(rows[1]!.split("\t")[3]).toBe("/work/llvm-project")
  })
})
