import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, query?: Record<string, string>) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      headers: {
        "x-opencode-directory": directory,
      },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
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
    expect(await status.json()).toEqual([])
  })

  test("serves binary file content as base64", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "data.bin"), Buffer.from([0, 1, 2]))

    const response = await request(FilePaths.content, tmp.path, { path: "data.bin" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      type: "binary",
      content: "AAEC",
      encoding: "base64",
      mimeType: "application/octet-stream",
    })
  })

  test("serves missing file content as empty text", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(FilePaths.content, tmp.path, { path: "missing.txt" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: "text", content: "" })
  })

  test("rejects file content paths outside the location", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(FilePaths.content, tmp.path, { path: "../outside.txt" })

    expect(response.status).not.toBe(200)
  })

  test("serves ignored status from the project root", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, ".gitignore"), "ignored.txt\n")
    await Bun.write(path.join(tmp.path, "ignored.txt"), "ignored")

    const response = await request(FilePaths.list, tmp.path, { path: "." })

    expect(response.status).toBe(200)
    expect(await response.json()).toContainEqual(
      expect.objectContaining({ name: "ignored.txt", path: "ignored.txt", type: "file", ignored: true }),
    )
  })

  test("serves search endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "hello.txt"), "needle")

    const [text, files, symbols] = await Promise.all([
      request(FilePaths.findText, tmp.path, { pattern: "needle" }),
      request(FilePaths.findFile, tmp.path, { query: "hello", type: "file" }),
      request(FilePaths.findSymbol, tmp.path, { query: "hello" }),
    ])

    expect(text.status).toBe(200)
    expect(await text.json()).toContainEqual(expect.objectContaining({ line_number: 1 }))

    expect(files.status).toBe(200)
    expect(await files.json()).toContain("hello.txt")

    expect(symbols.status).toBe(200)
    expect(await symbols.json()).toEqual([])
  })
})
