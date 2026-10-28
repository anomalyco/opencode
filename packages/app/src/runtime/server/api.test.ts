import { expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer, fileStreamUrl } from "./api"

test.each([
  [btoa("opencode:secret"), { password: "secret" }],
  [btoa("legacy:secret:with:colons"), { password: "secret:with:colons" }],
  [btoa(":secret"), { password: "secret" }],
  ["not base64", undefined],
  [btoa("missing-separator"), undefined],
])("authFromToken(%p) extracts only the password", (token, expected) => {
  expect(authFromToken(token)).toEqual(expected)
})

test("authTokenFromCredentials ignores usernames in legacy saved credentials", () => {
  const credentials = { username: "legacy", password: "secret" }
  expect(authTokenFromCredentials(credentials)).toBe(btoa("opencode:secret"))
})

test("fileStreamUrl never puts a credential in a media URL", () => {
  const input = { path: "clips/final cut.mp4", directory: "/work/app" }
  expect(fileStreamUrl({ url: "http://127.0.0.1:4096", password: "secret" }, input)).toBeUndefined()
  expect(fileStreamUrl({ url: "http://127.0.0.1:4096" }, input)).toBe(
    "http://127.0.0.1:4096/api/fs/read/clips/final%20cut.mp4?location%5Bdirectory%5D=%2Fwork%2Fapp",
  )
})

test("only message and inbox reads ask for media refs, so other cross-origin requests stay unpreflighted", async () => {
  const requests: Array<{ path: string; headers: Headers }> = []

  const api = createApiForServer({
    server: { url: "https://server.example:4096", password: "secret" },
    // SAFETY: the API client only calls fetch with a URL and init, which this stub accepts.
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        path: new URL(input instanceof Request ? input.url : input).pathname,
        headers: new Headers(init?.headers),
      })

      return Response.json({ data: [], cursor: {} })
    }) as typeof fetch,
  })

  await api.message.list({ sessionID: "ses_1" })
  await api.message.list({ sessionID: "ses_1" }, { mediaRefs: false, headers: { "X-Trace": "1" } })
  await api.session.message.get({ sessionID: "ses_1", messageID: "msg_1" })
  await api.session.inbox.list({ sessionID: "ses_1" }, { headers: { "X-Trace": "1" } })
  await api.session.list()

  expect(
    requests.map((request) => [
      request.path,
      request.headers.get("x-opencode-capabilities"),
      request.headers.get("authorization"),
    ]),
  ).toEqual([
    ["/api/session/ses_1/message", "experimental-media-uri", `Basic ${btoa("opencode:secret")}`],
    ["/api/session/ses_1/message", null, `Basic ${btoa("opencode:secret")}`],
    ["/api/session/ses_1/message/msg_1", "experimental-media-uri", `Basic ${btoa("opencode:secret")}`],
    ["/api/session/ses_1/inbox", "experimental-media-uri", `Basic ${btoa("opencode:secret")}`],
    ["/api/session", null, `Basic ${btoa("opencode:secret")}`],
  ])
  expect(requests[1].headers.get("x-trace")).toBe("1")
  expect(requests[3].headers.get("x-trace")).toBe("1")
})
