import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("createApiForServer", () => {
  test("uploads arbitrary files through the managed attachment route", async () => {
    const requests: Request[] = []
    const api = createApiForServer({
      server: { url: "http://localhost:4096", password: "secret" },
      fetch: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          requests.push(new Request(input, init))
          return Response.json({
            data: {
              id: "att_test",
              uri: "opencode://attachment/att_test",
              name: "archive.docx",
              mime: "application/octet-stream",
              size: 4,
            },
          })
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    })

    const result = await api.session.attachment({
      sessionID: "ses_test",
      file: new Blob([Uint8Array.of(0, 1, 2, 3)]),
      name: "archive.docx",
    })

    expect(result.uri).toBe("opencode://attachment/att_test")
    expect(requests[0]?.url).toBe("http://localhost:4096/api/session/ses_test/attachment")
    expect(requests[0]?.headers.get("authorization")).toStartWith("Basic ")
    expect((await requests[0]?.formData())?.get("file")).toBeInstanceOf(File)
  })

  test("preserves typed upload errors", async () => {
    const api = createApiForServer({
      server: { url: "http://localhost:4096" },
      fetch: Object.assign(
        async () =>
          Response.json(
            {
              _tag: "PayloadTooLargeError",
              message: "Attachment exceeds the file storage limit",
              scope: "file",
              maximumBytes: 25 * 1024 * 1024,
            },
            { status: 413 },
          ),
        { preconnect: globalThis.fetch.preconnect },
      ),
    })

    await expect(
      api.session.attachment({ sessionID: "ses_test", file: new Blob(["too large"]), name: "large.bin" }),
    ).rejects.toMatchObject({
      _tag: "PayloadTooLargeError",
      message: "Attachment exceeds the file storage limit",
    })
  })
})
