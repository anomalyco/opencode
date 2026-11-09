import { expect, test } from "bun:test"
import { mediaHashFromUri, OpenCode, withMediaRefs } from "../src/promise/index"

test("withMediaRefs asks for media refs on message and inbox reads only", async () => {
  const requests: Array<{ path: string; headers: Headers }> = []
  const api = withMediaRefs(
    OpenCode.make({
      baseUrl: "http://localhost:3000",
      headers: { Authorization: "Basic secret" },
      // SAFETY: the API client only calls fetch with a URL and init, which this stub accepts.
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          path: new URL(input instanceof Request ? input.url : input).pathname,
          headers: new Headers(init?.headers),
        })
        return Response.json({ data: [], cursor: {} })
      }) as typeof fetch,
    }),
  )

  await api.message.list({ sessionID: "ses_1" })
  await api.message.list({ sessionID: "ses_1" }, { mediaRefs: false })
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
    ["/api/session/ses_1/message", "experimental-media-uri", "Basic secret"],
    ["/api/session/ses_1/message", null, "Basic secret"],
    ["/api/session/ses_1/message/msg_1", "experimental-media-uri", "Basic secret"],
    ["/api/session/ses_1/inbox", "experimental-media-uri", "Basic secret"],
    ["/api/session", null, "Basic secret"],
  ])
  expect(requests[3]?.headers.get("x-trace")).toBe("1")
})

test.each([
  [`media:${"a".repeat(64)}`, "a".repeat(64)],
  [`media:${"A".repeat(64)}`, undefined],
  [`media:${"a".repeat(63)}`, undefined],
  ["data:image/png;base64,AAA", undefined],
  [undefined, undefined],
])("mediaHashFromUri(%p)", (uri, hash) => {
  expect(mediaHashFromUri(uri)).toBe(hash)
})
