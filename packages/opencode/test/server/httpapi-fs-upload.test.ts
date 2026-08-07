import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

const boundary = "----opencode-test-boundary"

function multipartBody(parts: Array<{ filename: string; content: string; contentType?: string }>) {
  const body: string[] = []
  for (const part of parts) {
    body.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${part.filename}"\r\nContent-Type: ${part.contentType ?? "text/plain"}\r\n\r\n${part.content}\r\n`,
    )
  }
  body.push(`--${boundary}--\r\n`)
  return body.join("")
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("fs.upload HttpApi", () => {
  test("returns 400 for a multipart body error", async () => {
    await using tmp = await tmpdir({ git: true })

    // The body uses a different boundary than the declared content-type, so the
    // multipart parser fails with a Parse error instead of producing parts.
    const wrongBoundary = "----different-boundary"
    const response = await request("/api/fs/upload?path=target.txt", tmp.path, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody([
        { filename: "a.txt", content: "a" },
        { filename: "b.txt", content: "b" },
      ]).replaceAll(boundary, wrongBoundary),
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain("InvalidRequestError")
  })

  test("returns 500 for a real filesystem error and preserves the existing target", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "target.txt", "inner.txt"), "x")

    const response = await request("/api/fs/upload?path=target.txt", tmp.path, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody([{ filename: "a.txt", content: "a" }]),
    })

    expect(response.status).toBe(500)
    expect(await Bun.file(path.join(tmp.path, "target.txt", "inner.txt")).text()).toBe("x")
  })

  test("returns 500 for a real filesystem error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "blocker.txt"), "not a directory")

    const response = await request("/api/fs/upload?path=blocker.txt/nested/file.txt", tmp.path, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody([{ filename: "a.txt", content: "a" }]),
    })

    expect(response.status).toBe(500)
  })

  test("writes the uploaded file on success", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request("/api/fs/upload?path=target.txt", tmp.path, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody([{ filename: "a.txt", content: "hello world" }]),
    })

    expect(response.status).toBe(204)
    expect(await Bun.file(path.join(tmp.path, "target.txt")).text()).toBe("hello world")
  })

  test("writes an application/json file part", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request("/api/fs/upload?path=data.json", tmp.path, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody([{ filename: "data.json", content: '{"a":1}', contentType: "application/json" }]),
    })

    expect(response.status).toBe(204)
    expect(await Bun.file(path.join(tmp.path, "data.json")).text()).toBe('{"a":1}')
  })
})
