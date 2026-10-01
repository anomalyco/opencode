import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { ServerAuth } from "../../src/server/auth"
import { PtyID } from "@opencode-ai/core/pty/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { mkdir } from "fs/promises"
import path from "path"

function app(input: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input.password,
            OPENCODE_SERVER_USERNAME: input.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return {
    fetch: (request: Request) => handler(request, HttpApiApp.context),
    request(input: string | URL | Request, init?: RequestInit) {
      return this.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
}

function basic(username: string, password: string) {
  return ServerAuth.header({ username, password }) ?? ""
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => {})
}

async function writeHttpPlugin(directory: string) {
  const serverMarker = path.join(directory, "plugin-server-ran")
  const fetchMarker = path.join(directory, "plugin-fetch-ran")
  await markPluginDependenciesReady(path.join(directory, ".opencode"))
  await mkdir(path.join(directory, ".opencode", "plugin"), { recursive: true })
  await Bun.write(
    path.join(directory, ".opencode", "plugin", "http.ts"),
    [
      "export default {",
      '  id: "auth-test",',
      "  server: async () => {",
      `    await Bun.write(${JSON.stringify(serverMarker)}, "ran")`,
      "    return {",
      "      http: {",
      "        fetch: async () => {",
      `          await Bun.write(${JSON.stringify(fetchMarker)}, "ran")`,
      "          return Response.json({ ok: true })",
      "        },",
      "      },",
      "    }",
      "  },",
      "}",
      "",
    ].join("\n"),
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi instance route authorization", () => {
  test("requires configured auth before opening the instance event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const server = app({ password: "secret" })
    const headers = { "x-opencode-directory": tmp.path }

    const missing = await server.request(EventPaths.event, { headers })
    await cancelBody(missing)
    expect(missing.status).toBe(401)

    const authed = await server.request(EventPaths.event, {
      headers: { ...headers, authorization: basic("opencode", "secret") },
    })
    await cancelBody(authed)
    expect(authed.status).toBe(200)
  })

  test("requires configured auth before resolving the PTY websocket route", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const server = app({ password: "secret" })
    const route = PtyPaths.connect.replace(":ptyID", PtyID.ascending())
    const headers = { "x-opencode-directory": tmp.path }

    const missing = await server.request(route, { headers })
    await cancelBody(missing)
    expect(missing.status).toBe(401)

    const authed = await server.request(route, {
      headers: { ...headers, authorization: basic("opencode", "secret") },
    })
    await cancelBody(authed)
    expect(authed.status).toBe(404)
  })

  test("requires configured auth before dispatching plugin routes", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { formatter: false, lsp: false },
      init: writeHttpPlugin,
    })
    const server = app({ password: "secret" })
    const route = "/api/plugins/auth-test"
    const headers = { "x-opencode-directory": tmp.path }
    const serverMarker = path.join(tmp.path, "plugin-server-ran")
    const fetchMarker = path.join(tmp.path, "plugin-fetch-ran")

    const missing = await server.request(route, { headers })
    expect(missing.status).toBe(401)
    expect(await Bun.file(serverMarker).exists()).toBe(false)
    expect(await Bun.file(fetchMarker).exists()).toBe(false)

    const authed = await server.request(route, {
      headers: { ...headers, authorization: basic("opencode", "secret") },
    })
    expect(authed.status).toBe(200)
    expect(await authed.json()).toEqual({ ok: true })
    expect(await Bun.file(serverMarker).exists()).toBe(true)
    expect(await Bun.file(fetchMarker).exists()).toBe(true)
  })
})
