import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { BasePath } from "../src/base-path"

test("base paths normalize to a slash-led path without a trailing slash", () => {
  expect(BasePath.normalize(undefined)).toBe("")
  expect(BasePath.normalize("")).toBe("")
  expect(BasePath.normalize("/")).toBe("")
  expect(BasePath.normalize("opencode")).toBe("/opencode")
  expect(BasePath.normalize("/opencode/")).toBe("/opencode")
  expect(BasePath.normalize(" /team/opencode// ")).toBe("/team/opencode")
})

test("base paths reject anything but plain path segments", () => {
  for (const input of ["/a b", "/../opencode", "/./opencode", "/op?x", "/op#x", '/op"<', "/a//b"])
    expect(BasePath.normalize(input)).toBeUndefined()
  expect(BasePath.invalid("/a b").message).toBe(
    'Invalid base path "/a b": use letters, digits, "-", "_", "." or "~", separated by "/"',
  )
})

test("mounted apps see requests without the prefix", async () => {
  const app = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return HttpServerResponse.text(request.url)
  })
  const send = (path: string) =>
    Effect.runPromise(
      BasePath.mount("/opencode", app).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(new Request(`http://localhost${path}`))),
        Effect.map(HttpServerResponse.toWeb),
      ),
    )

  const forwarded = await send("/opencode/api/session?limit=5")
  expect(forwarded.status).toBe(200)
  expect(await forwarded.text()).toBe("/api/session?limit=5")

  // `//api/session` would parse as host `api`, so the leading slashes collapse.
  expect(await (await send("/opencode//api/session")).text()).toBe("/api/session")

  const bare = await send("/opencode?x=1")
  expect(bare.status).toBe(301)
  expect(bare.headers.get("location")).toBe("/opencode/?x=1")

  expect((await send("/api/session")).status).toBe(404)
  expect((await send("/opencodex/api/session")).status).toBe(404)
})

test("an empty base path leaves the app unchanged", () => {
  const app = Effect.succeed(HttpServerResponse.empty())
  expect(BasePath.mount("", app)).toBe(app)
})
