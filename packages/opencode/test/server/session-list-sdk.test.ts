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
  test("v2 implicitly filters by current directory subtree", async () => {
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

    expect(ids).not.toContain(root.id)
    expect(ids).toContain(child.id)
  })

  test("v1 implicitly filters by current directory subtree", async () => {
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

    expect(ids).not.toContain(root.id)
    expect(ids).toContain(child.id)
  })
})

describe("session.list with ancestor directory filtering", () => {
  test("v2 allows ancestors but not siblings", async () => {
    await using tmp = await tmpdir({ git: true })
    const a = `${tmp.path}/.worktrees/a`
    const b = `${tmp.path}/.worktrees/b`
    await mkdir(a, { recursive: true })
    await mkdir(b, { recursive: true })

    const key = `ancestor-v2-${Date.now()}`
    const sa = await Instance.provide({
      directory: a,
      fn: async () => Session.create({ title: `${key}-a` }),
    })
    const sb = await Instance.provide({
      directory: b,
      fn: async () => Session.create({ title: `${key}-b` }),
    })

    const app = Server.Default().app
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      return app.request(req)
    }) as typeof globalThis.fetch

    const root = v2({
      baseUrl: "http://opencode.internal",
      directory: tmp.path,
      fetch: fetcher,
    })
    const child = v2({
      baseUrl: "http://opencode.internal",
      directory: b,
      fetch: fetcher,
    })

    const rootIds = ((await root.session.list()).data ?? []).map((item) => item.id)
    const childIds = ((await child.session.list()).data ?? []).map((item) => item.id)

    expect(rootIds).toContain(sa.id)
    expect(rootIds).toContain(sb.id)
    expect(childIds).toContain(sb.id)
    expect(childIds).not.toContain(sa.id)
  })

  test("v1 allows ancestors but not siblings", async () => {
    await using tmp = await tmpdir({ git: true })
    const a = `${tmp.path}/.worktrees/a`
    const b = `${tmp.path}/.worktrees/b`
    await mkdir(a, { recursive: true })
    await mkdir(b, { recursive: true })

    const key = `ancestor-v1-${Date.now()}`
    const sa = await Instance.provide({
      directory: a,
      fn: async () => Session.create({ title: `${key}-a` }),
    })
    const sb = await Instance.provide({
      directory: b,
      fn: async () => Session.create({ title: `${key}-b` }),
    })

    const app = Server.Default().app
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      return app.request(req)
    }) as typeof globalThis.fetch

    const root = v1({
      baseUrl: "http://opencode.internal",
      directory: tmp.path,
      fetch: fetcher,
    })
    const child = v1({
      baseUrl: "http://opencode.internal",
      directory: b,
      fetch: fetcher,
    })

    const rootIds = ((await root.session.list()).data ?? []).map((item) => item.id)
    const childIds = ((await child.session.list()).data ?? []).map((item) => item.id)

    expect(rootIds).toContain(sa.id)
    expect(rootIds).toContain(sb.id)
    expect(childIds).toContain(sb.id)
    expect(childIds).not.toContain(sa.id)
  })
})
