import { afterEach, describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { Attachment } from "@opencode-ai/schema/attachment"
import { Session } from "@opencode-ai/schema/session"
import { Context, Schema } from "effect"
import fs from "fs/promises"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

// SAFETY: The generated test handler accepts an erased runtime context and requires no contextual services here.
const context = Context.empty() as Context.Context<unknown>
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Session.ID }) })
const AttachmentResponse = Schema.Struct({ data: Attachment.Info })

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

async function createSession(directory: string) {
  const response = await request("/api/session", directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ location: { directory } }),
  })
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(SessionResponse)(await response.json())
}

function form(bytes: BlobPart[], name: string, type = "application/octet-stream") {
  const data = new FormData()
  data.append("file", new File(bytes, name, { type }))
  return data
}

function streamForm(chunks: Uint8Array[], name: string, abort = false) {
  const boundary = "opencode-attachment-test"
  const encoder = new TextEncoder()
  const parts = [
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    ...chunks,
    ...(abort ? [] : [encoder.encode(`\r\n--${boundary}--\r\n`)]),
  ]
  const state = { index: 0 }
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[state.index]
        if (part) {
          state.index += 1
          controller.enqueue(part)
          return
        }
        if (abort) {
          controller.error(new Error("client aborted upload"))
          return
        }
        controller.close()
      },
    }),
  }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 attachment HttpApi", () => {
  test("uploads, admits, and isolates a managed attachment", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = await createSession(tmp.path)
    const second = await createSession(tmp.path)
    const uploaded = await request(`/api/session/${first.data.id}/attachment`, tmp.path, {
      method: "POST",
      body: form([new Uint8Array([1, 2, 3])], "report.bin"),
    })
    expect(uploaded.status).toBe(200)
    const attachment = Schema.decodeUnknownSync(AttachmentResponse)(await uploaded.json())
    expect(attachment.data).toMatchObject({
      uri: `opencode://attachment/${attachment.data.id}`,
      name: "report.bin",
      mime: "application/octet-stream",
      size: 3,
    })
    const admitted = await request(`/api/session/${first.data.id}/prompt`, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: { text: "Inspect it", files: [{ uri: attachment.data.uri }] }, resume: false }),
    })
    expect(admitted.status).toBe(200)
    expect(await admitted.json()).toMatchObject({
      data: {
        prompt: {
          files: [{ uri: attachment.data.uri, name: "report.bin", mime: "application/octet-stream" }],
        },
      },
    })

    const rejected = await request(`/api/session/${second.data.id}/prompt`, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: { text: "Inspect it", files: [{ uri: attachment.data.uri }] }, resume: false }),
    })
    expect(rejected.status).toBe(404)
    expect(await rejected.json()).toMatchObject({
      _tag: "AttachmentNotFoundError",
      sessionID: second.data.id,
      attachmentID: attachment.data.id,
    })
  })

  test("returns a typed 413 and removes the partial upload", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await createSession(tmp.path)
    const directory = path.join(Global.Path.data, "attachments", encodeURIComponent(session.data.id))
    const response = await request(`/api/session/${session.data.id}/attachment`, tmp.path, {
      method: "POST",
      body: form([new Uint8Array(25 * 1024 * 1024 + 1)], "oversized.bin"),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      _tag: "PayloadTooLargeError",
      scope: "file",
      maximumBytes: 25 * 1024 * 1024,
    })
    expect(await fs.readdir(directory).catch(() => [])).toEqual([])
  })

  test("streams a chunked multipart upload without Content-Length", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await createSession(tmp.path)
    const input = streamForm([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], "chunked.bin")
    expect(new Headers(input.headers).has("content-length")).toBe(false)
    const response = await request(`/api/session/${session.data.id}/attachment`, tmp.path, {
      method: "POST",
      ...input,
    })

    expect(response.status).toBe(200)
    expect(Schema.decodeUnknownSync(AttachmentResponse)(await response.json()).data).toMatchObject({
      name: "chunked.bin",
      size: 5,
    })
  })

  test("removes a partial attachment when the request body aborts", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await createSession(tmp.path)
    const directory = path.join(Global.Path.data, "attachments", encodeURIComponent(session.data.id))
    const response = await request(`/api/session/${session.data.id}/attachment`, tmp.path, {
      method: "POST",
      ...streamForm([new Uint8Array([1, 2, 3])], "aborted.bin", true),
    }).catch(() => undefined)

    expect(response?.status).not.toBe(200)
    expect(await fs.readdir(directory).catch(() => [])).toEqual([])
  })

  test("rejects non-canonical forms of the managed attachment scheme", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await createSession(tmp.path)
    const uploaded = await request(`/api/session/${session.data.id}/attachment`, tmp.path, {
      method: "POST",
      body: form([new Uint8Array([1])], "private.bin"),
    })
    const attachment = Schema.decodeUnknownSync(AttachmentResponse)(await uploaded.json()).data
    const responses = await Promise.all(
      [
        attachment.uri.replace("opencode", "OPENCODE"),
        attachment.uri.replace("attachment", "ATTACHMENT"),
        `${attachment.uri}/extra`,
      ].map((uri) =>
        request(`/api/session/${session.data.id}/prompt`, tmp.path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: { text: "Inspect it", files: [{ uri }] }, resume: false }),
        }),
      ),
    )

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _tag: "AttachmentNotFoundError", sessionID: session.data.id }),
      ]),
    )
  })
})
