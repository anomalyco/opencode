import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { SessionID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

function app() {
  return Server.Default().app
}

function request(url: string, init?: RequestInit) {
  return Effect.promise(async () => app().request(url, init))
}

function withTmp<A, E, R>(
  options: Parameters<typeof tmpdir>[0],
  fn: (tmp: Awaited<ReturnType<typeof tmpdir>>) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap(fn))
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

// Regression for the "OpenAPI advertises ?directory&workspace, runtime
// rejects them" drift class. Each affected route must accept both params
// without 400.
describe("httpapi query schema drift", () => {
  const routingParams = (dir: string) =>
    `directory=${encodeURIComponent(dir)}&workspace=${encodeURIComponent("ws_test")}`

  const expectNotSchemaRejection = (status: number, url: string) => {
    expect(status, `route ${url} 400'd, query schema is missing routing fields`).not.toBe(400)
  }

  it.live(
    "session list accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/session?${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "session messages accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/session/${SessionID.descending()}/message?limit=80&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "file find/file accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/find/file?query=foo&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "file find/text accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/find?pattern=foo&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "file read accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/file?path=foo&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "experimental session list accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/experimental/session?${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "experimental tool list accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/experimental/tool?provider=anthropic&model=claude&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )

  it.live(
    "vcs diff accepts directory and workspace",
    withTmp({ config: { formatter: false, lsp: false } }, (tmp) =>
      Effect.gen(function* () {
        const url = `/vcs/diff?mode=working&${routingParams(tmp.path)}`
        const response = yield* request(url)
        expectNotSchemaRejection(response.status, url)
      }),
    ),
  )
})
