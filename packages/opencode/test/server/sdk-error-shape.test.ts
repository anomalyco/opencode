/**
 * Regression tests for the SDK error shape — the v2 SDK's `throwOnError: true`
 * path used to throw raw values (empty strings or POJOs from JSON-decoded
 * error bodies). The TUI catches those and `e.message`/`e.stack` are
 * undefined, so users see `[object Object]` or a blank crash.
 *
 * Both cases must throw a real `Error` instance with a non-empty `.message`
 * extracted from the response body, plus `.status` and `.body` attached.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

void Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function client(directory: string) {
  return createOpencodeClient({
    baseUrl: "http://test",
    directory,
    fetch: ((req: Request) => Server.Default().app.fetch(req)) as unknown as typeof fetch,
  })
}

describe("v2 SDK error shape", () => {
  test("404 with NamedError body throws a real Error carrying the server message", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)

    let caught: unknown
    try {
      await sdk.session.get({ sessionID: "ses_no_such" }, { throwOnError: true })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    const cause = err.cause as { body?: any; status?: number }
    expect(err.message).toContain("Session not found")
    expect(cause.status).toBe(404)
    expect(cause.body).toMatchObject({
      name: "NotFoundError",
      data: { message: expect.stringContaining("Session not found") },
    })
  })

  test("400 schema rejection: SDK extracts the field-level reason from the NamedError body", async () => {
    // Canary for the #26631 wire shape. Asserts the contract end-to-end:
    // server emits {name:"BadRequest", data:{message, kind}}, SDK's
    // wrapClientError extracts .data.message into Error.message. If either
    // side regresses (#26457 reverted because both layers were missing),
    // this test fails before users see (empty response body).
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)

    let caught: unknown
    try {
      await sdk.sync.history.list({ body: { aggregate: -1 } as any }, { throwOnError: true })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    const cause = err.cause as { body?: any; status?: number }
    expect(cause.status).toBe(400)
    expect(cause.body).toMatchObject({
      name: "BadRequest",
      data: { kind: expect.stringMatching(/^(Body|Payload)$/) },
    })
    expect(typeof cause.body.data.message).toBe("string")
    expect(cause.body.data.message.length).toBeGreaterThan(0)
    // Whatever the server put in data.message must be what the user sees.
    expect(err.message).toBe(cause.body.data.message)
  })
})
