import { afterEach, describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Server } from "../../src/server/server"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ask = (input: Permission.AskInput) => AppRuntime.runPromise(Permission.Service.use((svc) => svc.ask(input)))

afterEach(async () => {
  await Instance.disposeAll()
})

describe("experimental permission httpapi", () => {
  test("lists pending permissions, replies, and serves docs", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default().app
    const headers = {
      "content-type": "application/json",
      "x-opencode-directory": tmp.path,
    }
    let pending!: ReturnType<typeof ask>

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        pending = ask({
          sessionID: SessionID.make("ses_test"),
          permission: "bash",
          patterns: ["ls"],
          metadata: { cmd: "ls" },
          always: ["ls"],
          ruleset: [],
        })
      },
    })

    const list = await app.request("/experimental/httpapi/permission", {
      headers,
    })

    expect(list.status).toBe(200)
    const items = await list.json()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      permission: "bash",
      patterns: ["ls"],
      metadata: { cmd: "ls" },
      always: ["ls"],
    })

    const doc = await app.request("/experimental/httpapi/permission/doc", {
      headers,
    })

    expect(doc.status).toBe(200)
    const spec = await doc.json()
    expect(spec.paths["/experimental/httpapi/permission"]?.get?.operationId).toBe("permission.list")
    expect(spec.paths["/experimental/httpapi/permission/{requestID}/reply"]?.post?.operationId).toBe("permission.reply")

    const reply = await app.request(`/experimental/httpapi/permission/${items[0].id}/reply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reply: "once" }),
    })

    expect(reply.status).toBe(200)
    expect(await reply.json()).toBe(true)
    expect(await pending).toBeUndefined()
  })
})
