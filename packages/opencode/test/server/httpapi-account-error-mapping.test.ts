import { afterEach, describe, expect, mock, test } from "bun:test"
import { Effect, Layer } from "effect"

// Account.orgsByAccount() can fail with AccountServiceError when the
// upstream Anthropic Console API is unreachable. The HTTP API used to
// pipe the call through Effect.orDie, which converts the typed error
// into a defect — surfacing as a 500 with the raw stack trace embedded
// in the response body.
//
// The handlers now map the failure onto HttpApiError.InternalServerError
// and the endpoints declare it as a typed error. Operators get a
// structured 500 response with no stack-trace leak, and future error
// middleware can recognize the failure type instead of seeing a defect.
//
// To force the failure path, mock @/account/account so its defaultLayer
// provides an Account.Service whose orgsByAccount returns Effect.fail.

const ORIG = await import("../../src/account/account")

const failingAccountLayer = Layer.mock(ORIG.Service, {
  orgsByAccount: () =>
    Effect.fail(new ORIG.AccountServiceError({ message: "simulated upstream failure" })),
})

const mocked = {
  ...ORIG,
  defaultLayer: failingAccountLayer,
  layer: failingAccountLayer,
  Account: {
    ...ORIG.Account,
    defaultLayer: failingAccountLayer,
    layer: failingAccountLayer,
  },
}

void mock.module("@/account/account", () => mocked)
void mock.module("../../src/account/account", () => mocked)

const { Flag } = await import("@opencode-ai/core/flag/flag")
const Log = await import("@opencode-ai/core/util/log")
const { Server } = await import("../../src/server/server")
const { ExperimentalPaths } = await import("../../src/server/routes/instance/httpapi/groups/experimental")
const { resetDatabase } = await import("../fixture/db")
const { disposeAllInstances, tmpdir } = await import("../fixture/fixture")

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

function httpApiApp() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

async function probe(path: string) {
  await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
  return httpApiApp().request(path, {
    headers: { "x-opencode-directory": tmp.path },
  })
}

describe("HTTP API account failure mapping", () => {
  test("/experimental/console returns a structured 500, not a stack-trace defect", async () => {
    const response = await probe(ExperimentalPaths.console)
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toContain("\n    at ")
    const json = JSON.parse(body)
    expect(json._tag).toBe("InternalServerError")
  })

  test("/experimental/console/orgs returns a structured 500, not a stack-trace defect", async () => {
    const response = await probe(ExperimentalPaths.consoleOrgs)
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toContain("\n    at ")
    const json = JSON.parse(body)
    expect(json._tag).toBe("InternalServerError")
  })
})
