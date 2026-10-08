import { describe, expect, test } from "bun:test"
import type { WorkspaceInfo } from "@opencode-ai/plugin"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { MainbrellaAdapter } from "../../src/plugin/mainbrella/mainbrella"

const apiKey = `mb_${"a".repeat(64)}`
const createdAt = "2026-10-05T12:00:00.000Z"
const commandBody = z.object({ command: z.string() })

async function rejects(value: unknown, message?: string) {
  const error: unknown = await Promise.resolve(value).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(Error)
  if (message && error instanceof Error) expect(error.message).toContain(message)
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-mainbrella-"))
  const state = {
    running: true,
    previews: true,
    previewStatus: 201,
    previewUrl: "",
    version: InstallationVersion,
    commandExit: 0,
    execute: undefined as ((script: string) => Promise<number>) | undefined,
    requests: [] as { url: URL; method: string; authorization: string | null; body: unknown }[],
    grants: 0,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body: unknown = request.method === "POST" ? await request.json() : undefined
      state.requests.push({ url, body, method: request.method, authorization: request.headers.get("authorization") })
      if (url.pathname === "/global/health") return Response.json({ healthy: true, version: state.version })
      if (request.headers.get("authorization") !== `Bearer ${apiKey}`) return new Response(null, { status: 401 })
      if (url.pathname === "/capabilities") return Response.json({ previews: { supported: state.previews } })
      if (url.pathname === "/containers" && request.method === "GET")
        return Response.json({ containers: state.running ? [{ id: "small", createdAt, status: "running" }] : [] })
      if (url.searchParams.get("id") !== "small" || url.searchParams.get("createdAt") !== createdAt)
        return new Response(null, { status: 409 })
      if (url.pathname === "/containers/exec" && request.method === "POST")
        return Response.json({
          exitCode: state.execute ? await state.execute(commandBody.parse(body).command) : state.commandExit,
          timedOut: false,
          outputTruncated: false,
        })
      if (url.pathname === "/containers/previews" && request.method === "POST") {
        state.grants += 1
        if (state.previewStatus !== 201) return new Response(null, { status: state.previewStatus })
        return Response.json(
          {
            id: String(state.grants).padStart(32, "0"),
            createdAt,
            expiresAt: Date.now() + 3_600_000,
            url: state.previewUrl || url.origin + "/",
          },
          { status: 201 },
        )
      }
      if (url.pathname === "/containers/previews" && request.method === "DELETE")
        return Response.json({ revoked: true })
      return new Response(null, { status: 405 })
    },
  })
  const adapter = MainbrellaAdapter({ apiKey, apiUrl: server.url.origin, containerID: "small", createdAt }, directory)
  const info: WorkspaceInfo = await adapter.configure({
    id: "wrk_mainbrella_test",
    type: "mainbrella",
    name: "test",
    branch: null,
    directory: null,
    extra: null,
    projectID: "project-test",
  })
  const receipt = async () =>
    path.join(directory, (await fs.readdir(directory)).find((name) => name.endsWith(".json"))!)
  return {
    state,
    server,
    adapter,
    info,
    directory,
    receipt,
    async [Symbol.asyncDispose]() {
      await server.stop(true)
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

describe("Mainbrella workspace adapter", () => {
  test.skipIf(process.platform === "win32" || !Bun.which("tmux"))(
    "launches and removes a real OpenCode server through tmux",
    async () => {
      await using ctx = await fixture()
      const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
      const port = probe.port!
      await probe.stop(true)
      const bin = path.join(ctx.directory, "bin")
      const project = path.join(ctx.directory, "project with ' quotes")
      await fs.mkdir(bin)
      await fs.mkdir(project)
      await Bun.write(path.join(project, "hello.txt"), "hello from the remote workspace\n")
      await fs.writeFile(
        path.join(bin, "opencode"),
        `#!/bin/sh\nexec '${process.execPath}' run '${path.resolve(import.meta.dir, "../../src/index.ts")}' "$@"\n`,
        { mode: 0o700 },
      )
      ctx.state.previewUrl = `http://127.0.0.1:${port}/`
      ctx.state.execute = async (script) => {
        const proc = Bun.spawn(["sh", "-c", script], {
          cwd: project,
          env: {
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            XDG_CONFIG_HOME: path.join(ctx.directory, "config"),
            XDG_DATA_HOME: path.join(ctx.directory, "data"),
            XDG_STATE_HOME: path.join(ctx.directory, "state"),
            XDG_CACHE_HOME: path.join(ctx.directory, "cache"),
            OPENCODE_TEST_HOME: ctx.directory,
            OPENCODE_MODELS_PATH: path.resolve(import.meta.dir, "../tool/fixtures/models-api.json"),
            OPENCODE_EXPERIMENTAL_EVENT_SYSTEM: "true",
          },
          stdout: "pipe",
          stderr: "pipe",
        })
        const result = await proc.exited
        if (result !== 0) throw new Error(`Guest command failed: ${await new Response(proc.stderr).text()}`)
        return result
      }
      const adapter = MainbrellaAdapter(
        { apiKey, apiUrl: ctx.server.url.origin, containerID: "small", createdAt, directory: project, port },
        path.join(ctx.directory, "receipt"),
      )
      const info = await adapter.configure({ ...ctx.info, id: `wrk_runtime_${port}` })
      try {
        await adapter.create(info, {})
        const target = await adapter.target(info)
        expect(target.type).toBe("remote")
        const response = await fetch(new URL("/file/content?path=hello.txt", ctx.state.previewUrl))
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ content: "hello from the remote workspace" })
      } finally {
        await adapter.remove(info)
      }
      await rejects(fetch(ctx.state.previewUrl))
      expect(await Bun.file(`/tmp/opencode-mainbrella-${port}/owner`).exists()).toBe(false)
    },
    30_000,
  )

  test("starts an isolated server and keeps credentials out of commands and public metadata", async () => {
    await using ctx = await fixture()
    await ctx.adapter.create(ctx.info, { OPENCODE_AUTH_CONTENT: "private-provider-token", MAINBRELLA_API_KEY: apiKey })
    expect(await ctx.adapter.target(ctx.info)).toEqual({ type: "remote", url: ctx.server.url.origin + "/" })
    expect(JSON.stringify(ctx.info)).not.toContain(apiKey)
    expect(JSON.stringify(ctx.info)).not.toContain("expiresAt")
    const launch = ctx.state.requests.find((request) => request.url.pathname === "/containers/exec")!
    expect(launch.body).toMatchObject({ timeoutMs: 20_000 })
    const script = commandBody.parse(launch.body).command
    expect(script).toContain("tmux")
    expect(script).toContain(ctx.info.id)
    expect(script).toContain("OPENCODE_SERVER_PASSWORD")
    expect(script).not.toContain(apiKey)
    expect(script).not.toContain("private-provider-token")
    expect(ctx.state.requests.find((request) => request.url.pathname === "/global/health")?.authorization).toBeNull()
    expect(ctx.state.requests.find((request) => request.url.pathname === "/containers/previews")?.body).toEqual({
      port: 4096,
      ttlSeconds: 3600,
    })
    if (process.platform !== "win32") expect((await fs.stat(await ctx.receipt())).mode & 0o777).toBe(0o600)
  })

  test("a new adapter instance reuses private connection state without issuing another preview", async () => {
    await using ctx = await fixture()
    await ctx.adapter.create(ctx.info, {})
    const reloaded = MainbrellaAdapter({ apiKey, containerID: "c99", createdAt }, ctx.directory)
    expect(await reloaded.target(ctx.info)).toEqual(await ctx.adapter.target(ctx.info))
    expect(ctx.state.grants).toBe(1)
  })

  test("renews an expired preview against the persisted generation", async () => {
    await using ctx = await fixture()
    await ctx.adapter.create(ctx.info, {})
    const file = await ctx.receipt()
    const saved = await Bun.file(file).json()
    saved.preview.expiresAt = Date.now() - 1
    await Bun.write(file, JSON.stringify(saved))
    expect((await ctx.adapter.target(ctx.info)).type).toBe("remote")
    expect(ctx.state.grants).toBe(2)
    expect((await Bun.file(file).json()).preview.id).toBe("2".padStart(32, "0"))
  })

  test("an unavailable generation fails before executing or issuing a preview", async () => {
    await using ctx = await fixture()
    ctx.state.running = false
    await rejects(ctx.adapter.create(ctx.info, {}), "generation is unavailable")
    expect(ctx.state.requests.every((request) => request.method === "GET")).toBe(true)
    await rejects(ctx.adapter.target(ctx.info), "no private connection state")
  })

  test("unsupported previews fail before starting the server", async () => {
    await using ctx = await fixture()
    ctx.state.previews = false
    await rejects(ctx.adapter.create(ctx.info, {}), "does not support protected previews")
    expect(ctx.state.requests.every((request) => request.method === "GET")).toBe(true)
  })

  test("uncertain preview issuance is retained and never retried automatically", async () => {
    await using ctx = await fixture()
    ctx.state.previewStatus = 503
    await rejects(ctx.adapter.create(ctx.info, {}), "503")
    expect((await Bun.file(await ctx.receipt()).json()).pendingPreview).toBe(true)
    await rejects(ctx.adapter.target(ctx.info), "needs reconciliation")
    expect(ctx.state.grants).toBe(1)
    await rejects(ctx.adapter.remove(ctx.info), "uncertain preview issuance")
    expect(await Bun.file(await ctx.receipt()).exists()).toBe(true)
  })

  test("removal stops only the adapter server and revokes its exact preview", async () => {
    await using ctx = await fixture()
    await ctx.adapter.create(ctx.info, {})
    await ctx.adapter.remove(ctx.info)
    const stop = ctx.state.requests.filter((request) => request.url.pathname === "/containers/exec")[1]
    expect(commandBody.parse(stop.body).command).toContain("kill-server")
    expect(commandBody.parse(stop.body).command).toContain(ctx.info.id)
    const revoke = ctx.state.requests.find((request) => request.method === "DELETE")!
    expect(revoke.url.pathname).toBe("/containers/previews")
    expect(revoke.url.searchParams.get("previewId")).toBe("1".padStart(32, "0"))
    expect(revoke.url.searchParams.get("createdAt")).toBe(createdAt)
    expect(await fs.readdir(ctx.directory)).toEqual([])
    expect(
      ctx.state.requests.some((request) => request.url.pathname === "/containers" && request.method !== "GET"),
    ).toBe(false)
  })

  test("removal of a stopped generation performs no mutation", async () => {
    await using ctx = await fixture()
    await ctx.adapter.create(ctx.info, {})
    ctx.state.running = false
    const count = ctx.state.requests.length
    await ctx.adapter.remove(ctx.info)
    expect(ctx.state.requests.slice(count).every((request) => request.method === "GET")).toBe(true)
    expect(await fs.readdir(ctx.directory)).toEqual([])
  })

  test("a version mismatch retains enough state for explicit cleanup", async () => {
    await using ctx = await fixture()
    ctx.state.version = "incompatible"
    await rejects(ctx.adapter.create(ctx.info, {}), "match the local OpenCode version")
    await ctx.adapter.remove(ctx.info)
    expect(await fs.readdir(ctx.directory)).toEqual([])
  })

  test("invalid preview destinations are revoked without making a guest request", async () => {
    await using ctx = await fixture()
    ctx.state.previewUrl = "https://example.com/"
    await rejects(ctx.adapter.create(ctx.info, {}), "invalid protected preview")
    expect(ctx.state.requests.some((request) => request.method === "DELETE")).toBe(true)
    expect(ctx.state.requests.some((request) => request.url.pathname === "/global/health")).toBe(false)
  })

  test("rejects invalid API origins and ambiguous generation identities before requests", async () => {
    const info: WorkspaceInfo = {
      id: "wrk_test",
      type: "mainbrella",
      name: "test",
      branch: null,
      directory: null,
      extra: null,
      projectID: "project-test",
    }
    for (const apiUrl of [
      "http://example.com",
      "https://user:secret@example.com",
      "https://api.mainbrella.com/?token=secret",
    ])
      expect(() => MainbrellaAdapter({ apiKey, apiUrl, containerID: "small", createdAt }).configure(info)).toThrow(
        "HTTPS origin",
      )
    expect(() => MainbrellaAdapter({ apiKey, containerID: "small", createdAt: "2026-10-05" }).configure(info)).toThrow(
      "exact MAINBRELLA_CREATED_AT",
    )
    expect(() =>
      MainbrellaAdapter({ apiKey, containerID: "small", createdAt, directory: "/workspace/../root" }).configure(info),
    ).toThrow("guest values")
  })

  test("copying a workspace is rejected before touching the sandbox", async () => {
    await using ctx = await fixture()
    await rejects(ctx.adapter.create(ctx.info, {}, ctx.info), "prepare a separate sandbox")
    expect(ctx.state.requests).toEqual([])
  })
})
