import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/file"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(url, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("file HttpApi", () => {
  test("serves read endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello")

    const [list, content, status] = await Promise.all([
      request(FilePaths.list, tmp.path, { path: "." }),
      request(FilePaths.content, tmp.path, { path: "hello.txt" }),
      request(FilePaths.status, tmp.path),
    ])

    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ name: "hello.txt", path: "hello.txt", type: "file" }),
    )

    expect(content.status).toBe(200)
    expect(await content.json()).toMatchObject({ type: "text", content: "hello" })

    expect(status.status).toBe(200)
    expect(await status.json()).toContainEqual({ path: "hello.txt", added: 1, removed: 0, status: "added" })
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "hello search target")

    const [find, findFile, findSymbol] = await Promise.all([
      request(FilePaths.find, tmp.path, { pattern: "search target" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", limit: "10" }),
      request(FilePaths.findSymbol, tmp.path, { query: "anything" }),
    ])

    expect(find.status).toBe(200)
    expect(await find.json()).toContainEqual(expect.objectContaining({ path: { text: "hello.txt" } }))

    expect(findFile.status).toBe(200)
    expect(await findFile.json()).toContain("hello.txt")

    expect(findSymbol.status).toBe(200)
    expect(await findSymbol.json()).toEqual([])
  })
})
