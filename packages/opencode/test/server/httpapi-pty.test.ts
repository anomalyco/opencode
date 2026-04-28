import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { PtyID } from "../../src/pty/schema"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/pty"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const testPty = process.platform === "win32" ? test.skip : test

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("pty HttpApi bridge", () => {
  test("serves available shell list through experimental Effect routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(PtyPaths.shells, { headers: { "x-opencode-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.any(String),
          name: expect.any(String),
          acceptable: expect.any(Boolean),
        }),
      ]),
    )
  })

  testPty("serves PTY JSON routes through experimental Effect routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const list = await app().request(PtyPaths.list, { headers })
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual([])

    const created = await app().request(PtyPaths.create, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 5"], title: "demo" }),
    })
    expect(created.status).toBe(200)
    const info = await created.json()

    try {
      expect(info).toMatchObject({ title: "demo", command: "/usr/bin/env", status: "running" })

      const found = await app().request(PtyPaths.get.replace(":ptyID", info.id), { headers })
      expect(found.status).toBe(200)
      expect(await found.json()).toMatchObject({ id: info.id, title: "demo" })

      const updated = await app().request(PtyPaths.update.replace(":ptyID", info.id), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: "renamed", size: { cols: 80, rows: 24 } }),
      })
      expect(updated.status).toBe(200)
      expect(await updated.json()).toMatchObject({ id: info.id, title: "renamed" })
    } finally {
      await app().request(PtyPaths.remove.replace(":ptyID", info.id), { method: "DELETE", headers })
    }

    const missing = await app().request(PtyPaths.get.replace(":ptyID", info.id), { headers })
    expect(missing.status).toBe(404)
  })

  test("returns 404 for missing PTY websocket before upgrade", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(PtyPaths.connect.replace(":ptyID", PtyID.ascending()), {
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(response.status).toBe(404)
  })
})
