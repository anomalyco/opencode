import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

async function waitDisposed(directory: string) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", onEvent)
      reject(new Error("timed out waiting for instance disposal"))
    }, 10_000)

    function onEvent(event: { directory?: string; payload: { type?: string } }) {
      if (event.payload.type !== "server.instance.disposed" || event.directory !== directory) return
      clearTimeout(timer)
      GlobalBus.off("event", onEvent)
      resolve()
    }

    GlobalBus.on("event", onEvent)
  })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("config HttpApi", () => {
  test("serves config update through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const disposed = waitDisposed(tmp.path)

    const response = await app().request("/config", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ username: "patched-user", formatter: false, lsp: false })
    await disposed
    expect(await Bun.file(path.join(tmp.path, "config.json")).json()).toMatchObject({
      username: "patched-user",
      formatter: false,
      lsp: false,
    })
  })
})
