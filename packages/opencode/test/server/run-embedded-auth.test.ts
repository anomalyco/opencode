// Set before Server modules load so ServerAuth.Config sees the password.
process.env.OPENCODE_SERVER_PASSWORD = "secret"
process.env.OPENCODE_SERVER_USERNAME = "opencode"

import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { ServerAuth } from "../../src/server/auth"
import { Server } from "../../src/server/server"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

Flag.OPENCODE_SERVER_PASSWORD = "secret"
Flag.OPENCODE_SERVER_USERNAME = "opencode"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function embeddedClient(directory: string, headers?: Record<string, string>) {
  return createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory,
    headers,
    fetch: ((req: Request) => Server.Default().app.fetch(req)) as unknown as typeof fetch,
  })
}

describe("embedded opencode run server auth", () => {
  test("session.create requires ServerAuth headers when OPENCODE_SERVER_PASSWORD is set", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const denied = await embeddedClient(tmp.path).session.create({ title: "embedded" })
    expect(denied.response.status).toBe(401)

    const created = await embeddedClient(tmp.path, ServerAuth.headers({ password: "secret" })).session.create({
      title: "embedded",
    })
    expect(created.response.status).toBe(200)
    expect(created.data?.id).toBeDefined()
  })
})
