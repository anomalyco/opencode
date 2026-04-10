import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import { createOpencodeClient as v1 } from "@opencode-ai/sdk"
import { createOpencodeClient as v2 } from "@opencode-ai/sdk/v2"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("session.list with sdk directory", () => {
  test("v2 does not implicitly filter by current directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = `${tmp.path}/.dmux/worktrees/a`
    await mkdir(dir, { recursive: true })

    const key = `worktree-v2-${Date.now()}`
    const root = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: `${key}-root` }),
    })
    const child = await Instance.provide({
      directory: dir,
      fn: async () => Session.create({ title: `${key}-child` }),
    })

    const app = Server.Default().app
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      return app.request(req)
    }) as typeof globalThis.fetch

    const sdk = v2({
      baseUrl: "http://opencode.internal",
      directory: dir,
      fetch: fetcher,
    })
    const res = await sdk.session.list({ search: key })
    const ids = (res.data ?? []).map((item) => item.id)

    expect(ids).toContain(root.id)
    expect(ids).toContain(child.id)
  })

  test("v1 does not implicitly filter by current directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = `${tmp.path}/.dmux/worktrees/a`
    await mkdir(dir, { recursive: true })

    const key = `worktree-v1-${Date.now()}`
    const root = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: `${key}-root` }),
    })
    const child = await Instance.provide({
      directory: dir,
      fn: async () => Session.create({ title: `${key}-child` }),
    })

    const app = Server.Default().app
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      return app.request(req)
    }) as typeof globalThis.fetch

    const sdk = v1({
      baseUrl: "http://opencode.internal",
      directory: dir,
      fetch: fetcher,
    })
    const res = await sdk.session.list()
    const ids = (res.data ?? []).map((item) => item.id)

    expect(ids).toContain(root.id)
    expect(ids).toContain(child.id)
  })
})
