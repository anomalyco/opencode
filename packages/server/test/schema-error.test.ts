import { expect } from "bun:test"
import { Generate } from "@opencode/core/generate"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

// The success schema declares `text` as a string, so a number fails response encoding.
const generate = makeLocationNode({
  service: Generate.Service,
  layer: Layer.succeed(
    Generate.Service,
    Generate.Service.of({
      text: () => Effect.succeed(42 as unknown as string),
      image: () => Effect.die("unused"),
      decisions: () => Effect.die("unused"),
    }),
  ),
  deps: [],
})

it.live("reports response encoding failures as server errors and request decoding failures as bad requests", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      { overrides: [Generate.node.replace(generate)] },
    )

    const encoding = yield* request(handler, { prompt: "hello" })
    expect(encoding.status).toBe(500)
    expect(encoding.body).toMatchObject({
      _tag: "UnknownError",
      message: "Server failed to encode its response. Check server logs for details.",
      ref: expect.stringMatching(/^err_/),
    })

    const decoding = yield* request(handler, { prompt: 1 })
    expect(decoding.status).toBe(400)
    expect(decoding.body).toMatchObject({ _tag: "InvalidRequestError", kind: "Payload" })
  }),
)

function request(handler: (request: Request) => Promise<Response>, body: unknown) {
  return Effect.promise(async () => {
    const response = await handler(
      new Request("http://opencode.local/api/experimental/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
    const json: unknown = await response.json()
    return { status: response.status, body: json }
  })
}
