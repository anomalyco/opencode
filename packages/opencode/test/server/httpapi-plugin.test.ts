import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer, Option, Stream } from "effect"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const pluginID = "test-http-plugin"
const projectOptions = { git: true, config: { formatter: false, lsp: false } }

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, LayerNode.compile(FSUtil.node), httpApiLayer))

function pluginSource(id: string, marker: string, http = true, disposeMarker?: string) {
  return [
    ...(disposeMarker ? ['import { writeFileSync } from "fs"', ""] : []),
    "export default {",
    `  id: ${JSON.stringify(id)},`,
    "  server: async () => ({",
    ...(http
      ? [
          "    http: {",
          "      fetch: async (request) => {",
          "        const url = new URL(request.url)",
          '        if (url.pathname === "/error") throw new Error("plugin failed")',
          '        if (url.pathname === "/non-response") return { nope: true }',
          '        if (url.pathname === "/stream") {',
          "          return new Response(new ReadableStream({",
          "            start(controller) {",
          '              controller.enqueue(new TextEncoder().encode("first"))',
          "            },",
          "          }), { headers: { 'content-type': 'text/plain' } })",
          "        }",
          '        if (url.pathname === "/metadata") {',
          "          const headers = new Headers()",
          "          headers.append('set-cookie', 'one=1; Path=/')",
          "          headers.append('set-cookie', 'two=2; Path=/')",
          "          return new Response('metadata', { status: 299, statusText: 'Plugin Status', headers })",
          "        }",
          '        const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text()',
          "        return Response.json({",
          `          marker: ${JSON.stringify(marker)},`,
          "          method: request.method,",
          "          path: url.pathname,",
          "          query: Array.from(url.searchParams.entries()),",
          "          header: request.headers.get('x-plugin-request'),",
          "          body,",
          "        }, { status: 201, headers: { 'x-plugin-response': 'preserved' } })",
          "      },",
          "    },",
        ]
      : []),
    ...(disposeMarker
      ? [`    dispose: async () => { writeFileSync(${JSON.stringify(disposeMarker)}, "disposed") },`]
      : []),
    "  }),",
    "}",
    "",
  ].join("\n")
}

function writePlugins(
  files: Array<{ name: string; id: string; marker?: string; http?: boolean; disposeMarker?: string }>,
) {
  return (directory: string) =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      yield* Effect.promise(() => markPluginDependenciesReady(path.join(directory, ".opencode")))
      yield* Effect.forEach(
        files,
        (file) =>
          fs.writeWithDirs(
            path.join(directory, ".opencode", "plugin", `${file.name}.ts`),
            pluginSource(
              file.id,
              file.marker ?? file.name,
              file.http,
              file.disposeMarker ? path.join(directory, file.disposeMarker) : undefined,
            ),
          ),
        { discard: true },
      )
    })
}

function pluginPath(id: string, suffix = "") {
  return `/api/plugins/${encodeURIComponent(id)}${suffix}`
}

function requestFromWebHandler(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return Effect.promise(() =>
    Promise.resolve(
      HttpApiApp.webHandler().handler(
        new Request(new URL(route, "http://localhost"), { ...init, headers }),
        HttpApiApp.context,
      ),
    ),
  )
}

describe("plugin HTTP routes", () => {
  it.instance(
    "rebases scoped plugin requests and preserves Fetch responses",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const scopedID = "@scope/plugin"

      const root = yield* requestInDirectory(`${pluginPath(scopedID)}?value=one&value=two`, directory)
      expect(root.status).toBe(201)
      expect(root.headers["x-plugin-response"]).toBe("preserved")
      expect(yield* root.json).toEqual({
        marker: "primary",
        method: "GET",
        path: "/",
        query: [
          ["value", "one"],
          ["value", "two"],
        ],
        header: null,
        body: "",
      })

      const nested = yield* requestInDirectory(
        `${pluginPath(scopedID, "/sessions/pty-1/output")}?after=12`,
        directory,
        {
          method: "POST",
          headers: { "content-type": "text/plain", "x-plugin-request": "preserved" },
          body: "request body",
        },
      )
      expect(nested.status).toBe(201)
      expect(yield* nested.json).toMatchObject({
        marker: "primary",
        method: "POST",
        path: "/sessions/pty-1/output",
        query: [["after", "12"]],
        header: "preserved",
        body: "request body",
      })
    }),
    { ...projectOptions, init: writePlugins([{ name: "primary", id: "@scope/plugin", marker: "primary" }]) },
    30000,
  )

  it.instance(
    "returns streaming responses without buffering",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestInDirectory(pluginPath(pluginID, "/stream"), directory).pipe(
        Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.fail(new Error("response was buffered")) }),
      )
      const first = yield* response.stream.pipe(
        Stream.runHead,
        Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.fail(new Error("stream did not emit")) }),
      )

      expect(response.status).toBe(200)
      expect(Option.map(first, (chunk) => new TextDecoder().decode(chunk))).toEqual(Option.some("first"))
    }),
    { ...projectOptions, init: writePlugins([{ name: "stream", id: pluginID }]) },
    30000,
  )

  it.instance(
    "preserves status text and repeated Set-Cookie headers",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestFromWebHandler(pluginPath(pluginID, "/metadata"), directory)

      expect(response.status).toBe(299)
      expect(response.statusText).toBe("Plugin Status")
      expect(response.headers.getSetCookie()).toEqual(["one=1; Path=/", "two=2; Path=/"])
      expect(yield* Effect.promise(() => response.text())).toBe("metadata")
    }),
    { ...projectOptions, init: writePlugins([{ name: "metadata", id: pluginID }]) },
    30000,
  )

  it.instance(
    "returns 404 for unavailable handlers and duplicate ids",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const missing = yield* requestInDirectory(pluginPath("missing"), directory)
      const withoutHttp = yield* requestInDirectory(pluginPath("without-http"), directory)
      const duplicate = yield* requestInDirectory(pluginPath("duplicate"), directory)

      expect(missing.status).toBe(404)
      expect(withoutHttp.status).toBe(404)
      expect(duplicate.status).toBe(404)
    }),
    {
      ...projectOptions,
      init: writePlugins([
        { name: "without-http", id: "without-http", http: false },
        { name: "duplicate-a", id: "duplicate", marker: "one" },
        { name: "duplicate-b", id: "duplicate", marker: "two" },
      ]),
    },
    30000,
  )

  it.instance(
    "maps plugin failures and invalid results through the server error boundary",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const thrown = yield* requestInDirectory(pluginPath(pluginID, "/error"), directory)
      const invalid = yield* requestInDirectory(pluginPath(pluginID, "/non-response"), directory)

      expect(thrown.status).toBe(500)
      expect(invalid.status).toBe(500)
    }),
    { ...projectOptions, init: writePlugins([{ name: "error", id: pluginID }]) },
    30000,
  )

  it.live(
    "disposes plugin hooks and rebuilds the handler registry",
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({
        ...projectOptions,
        init: writePlugins([{ name: "lifecycle", id: pluginID, disposeMarker: "plugin-disposed" }]),
      })
      const fs = yield* FSUtil.Service
      const marker = path.join(directory, "plugin-disposed")

      const initial = yield* requestFromWebHandler(pluginPath(pluginID), directory)
      expect(initial.status).toBe(201)
      expect(yield* fs.exists(marker)).toBe(false)

      yield* Effect.promise(() => disposeAllInstances())
      expect(yield* fs.exists(marker)).toBe(true)

      yield* fs.remove(path.join(directory, ".opencode", "plugin", "lifecycle.ts"))
      const stale = yield* requestFromWebHandler(pluginPath(pluginID), directory)
      expect(stale.status).toBe(404)

      yield* Effect.promise(() => disposeAllInstances())
    }),
    30000,
  )

  it.live(
    "isolates handlers with the same id across directory instances",
    Effect.gen(function* () {
      const one = yield* tmpdirScoped({
        ...projectOptions,
        init: writePlugins([{ name: "same", id: pluginID, marker: "one" }]),
      })
      const two = yield* tmpdirScoped({
        ...projectOptions,
        init: writePlugins([{ name: "same", id: pluginID, marker: "two" }]),
      })

      const first = yield* requestInDirectory(pluginPath(pluginID), one)
      const second = yield* requestInDirectory(pluginPath(pluginID), two)

      expect(yield* first.json).toMatchObject({ marker: "one" })
      expect(yield* second.json).toMatchObject({ marker: "two" })
    }),
    30000,
  )
})
