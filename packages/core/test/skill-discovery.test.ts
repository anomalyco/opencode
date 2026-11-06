import fs from "fs/promises"
import path from "path"
import { createServer } from "node:http"
import { describe, expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientResponse, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Global } from "@opencode/util/global"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { SkillDiscovery } from "@opencode/core/skill/discovery"
import { tmpdir } from "./fixture/tmpdir"
import { advance } from "./lib/clock"
import { it } from "./lib/effect"

const fixture = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
  const state: {
    skills: unknown[]
    files: Record<string, string | Uint8Array>
    redirects: Record<string, string>
    requests: string[]
    headers: { path: string; authorization?: string; token?: string }[]
  } = { skills: [], files: {}, redirects: {}, requests: [], headers: [] }
  const server = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0 })
  const base = new URL("/catalog/", HttpServer.formatAddress(server.address)).href
  yield* server.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, base)
      state.requests.push(url.href)
      state.headers.push({
        path: url.pathname,
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        ...(request.headers["x-token"] ? { token: request.headers["x-token"] } : {}),
      })
      const redirect = state.redirects[url.pathname]
      if (redirect) return HttpServerResponse.redirect(redirect, { status: 302 })
      const body =
        url.pathname === "/catalog/index.json" ? JSON.stringify({ skills: state.skills }) : state.files[url.pathname]
      if (body instanceof Uint8Array) return HttpServerResponse.uint8Array(body)
      return HttpServerResponse.text(body ?? "Not Found", { status: body === undefined ? 404 : 200 })
    }),
  )
  return {
    cache: tmp.path,
    base,
    // The same server under another host name, so a redirect there crosses an origin boundary.
    otherOrigin: base.replace("127.0.0.1", "localhost"),
    pull: (
      skills: unknown[],
      files: Record<string, string | Uint8Array> = {},
      options: { headers?: Record<string, string>; redirects?: Record<string, string> } = {},
    ) =>
      Effect.gen(function* () {
        state.skills = skills
        state.files = files
        state.redirects = options.redirects ?? {}
        state.requests = []
        state.headers = []
        // Rebuild per pull so repeated calls exercise the disk cache, not a shared service.
        const directories = yield* Effect.gen(function* () {
          const discovery = yield* SkillDiscovery.Service
          return yield* discovery.pull(base, options.headers)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(SkillDiscovery.node, [Global.node.replace(Global.layerWith({ cache: tmp.path }))]),
          ),
        )
        return { directories, requests: state.requests.slice(), headers: state.headers.slice() }
      }),
  }
})

describe("SkillDiscovery.pull", () => {
  for (const input of [
    {
      name: "rejects skill name traversal without fetching files",
      skills: [{ name: "../outside", files: ["SKILL.md"] }],
    },
    {
      name: "rejects file traversal without fetching files",
      skills: [{ name: "deploy", files: ["SKILL.md", "../outside.md"] }],
    },
    {
      name: "rejects absolute file paths without fetching files",
      skills: [{ name: "deploy", files: ["SKILL.md", "/tmp/outside.md"] }],
    },
    {
      name: "rejects cross-origin file URLs without fetching files",
      skills: [{ name: "deploy", files: ["SKILL.md", "https://evil.example.test/outside.md"] }],
    },
  ]) {
    it.live(
      input.name,
      Effect.gen(function* () {
        const catalog = yield* fixture
        const result = yield* catalog.pull(input.skills)
        expect(result.directories).toEqual([])
        expect(result.requests).toEqual([`${catalog.base}index.json`])
        expect(yield* Effect.promise(() => fs.readdir(catalog.cache))).toEqual([])
      }),
    )
  }

  it.live(
    "downloads safe nested files under the skill root",
    Effect.gen(function* () {
      const catalog = yield* fixture
      const result = yield* catalog.pull([{ name: "deploy", files: ["SKILL.md", "references/guide.md"] }], {
        "/catalog/deploy/SKILL.md": "# Deploy",
        "/catalog/deploy/references/guide.md": "# Guide",
      })
      expect(result.directories).toHaveLength(1)
      expect(result.requests.toSorted()).toEqual(
        [
          `${catalog.base}index.json`,
          `${catalog.base}deploy/SKILL.md`,
          `${catalog.base}deploy/references/guide.md`,
        ].toSorted(),
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(result.directories[0], "SKILL.md")).text())).toBe(
        "# Deploy",
      )
      expect(
        yield* Effect.promise(() => Bun.file(path.join(result.directories[0], "references", "guide.md")).text()),
      ).toBe("# Guide")
    }),
  )

  it.live(
    "sends a source's headers to the catalog and its own origin only, and keeps the cache when they rotate",
    Effect.gen(function* () {
      const catalog = yield* fixture
      const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a])
      const headers = { authorization: "Bearer one", "X-Token": "two" }
      const result = yield* catalog.pull(
        [{ name: "deploy", version: "1", files: ["SKILL.md", "assets/logo.png", "references/guide.md"] }],
        {
          "/catalog/deploy/moved/SKILL.md": "# Deploy",
          "/catalog/deploy/assets/logo.png": image,
          "/catalog/deploy/references/guide.md": "# Guide",
        },
        {
          headers,
          redirects: {
            "/catalog/deploy/SKILL.md": `${catalog.base}deploy/moved/SKILL.md`,
            "/catalog/deploy/references/guide.md": `${catalog.otherOrigin}deploy/assets/logo.png`,
          },
        },
      )
      expect(result.directories).toHaveLength(1)
      expect(result.headers.toSorted((a, b) => `${a.path} ${a.token}`.localeCompare(`${b.path} ${b.token}`))).toEqual([
        { path: "/catalog/deploy/assets/logo.png", authorization: "Bearer one", token: "two" },
        // A redirect to another origin carries none of the source's headers.
        { path: "/catalog/deploy/assets/logo.png" },
        { path: "/catalog/deploy/moved/SKILL.md", authorization: "Bearer one", token: "two" },
        { path: "/catalog/deploy/references/guide.md", authorization: "Bearer one", token: "two" },
        { path: "/catalog/deploy/SKILL.md", authorization: "Bearer one", token: "two" },
        { path: "/catalog/index.json", authorization: "Bearer one", token: "two" },
      ])
      expect(
        yield* Effect.promise(() => Bun.file(path.join(result.directories[0], "assets", "logo.png")).bytes()),
      ).toEqual(image)
      expect(yield* Effect.promise(() => Bun.file(path.join(result.directories[0], "SKILL.md")).text())).toBe(
        "# Deploy",
      )

      const rotated = yield* catalog.pull(
        [{ name: "deploy", version: "1", files: ["SKILL.md", "assets/logo.png", "references/guide.md"] }],
        {},
        { headers: { authorization: "Bearer three" } },
      )
      expect(rotated.directories).toEqual(result.directories)
      expect(rotated.headers).toEqual([{ path: "/catalog/index.json", authorization: "Bearer three" }])
    }),
  )

  it.live(
    "refreshes cached files when the version changes",
    Effect.gen(function* () {
      const catalog = yield* fixture
      const first = yield* catalog.pull([{ name: "deploy", version: "1", files: ["SKILL.md"] }], {
        "/catalog/deploy/SKILL.md": "# Old",
      })
      const second = yield* catalog.pull([{ name: "deploy", version: "2", files: ["SKILL.md"] }], {
        "/catalog/deploy/SKILL.md": "# New",
      })

      expect(yield* Effect.promise(() => Bun.file(path.join(first.directories[0], "SKILL.md")).text())).toBe("# New")
      expect(second.requests).toContain(`${catalog.base}deploy/SKILL.md`)
      const third = yield* catalog.pull([{ name: "deploy", version: "2", files: ["SKILL.md"] }], {
        "/catalog/deploy/SKILL.md": "# Ignored",
      })
      expect(third.requests).toEqual([`${catalog.base}index.json`])
    }),
  )

  it.live(
    "publishes complete updates and removes stale files",
    Effect.gen(function* () {
      const catalog = yield* fixture
      const first = yield* catalog.pull([{ name: "deploy", version: "1", files: ["SKILL.md", "old.md"] }], {
        "/catalog/deploy/SKILL.md": "# Old",
        "/catalog/deploy/old.md": "old reference",
      })
      const root = first.directories[0]

      yield* catalog.pull([{ name: "deploy", version: "2", files: ["SKILL.md", "missing.md"] }], {
        "/catalog/deploy/SKILL.md": "# Partial",
      })
      expect(yield* Effect.promise(() => Bun.file(path.join(root, "SKILL.md")).text())).toBe("# Old")
      expect(yield* Effect.promise(() => Bun.file(path.join(root, "old.md")).text())).toBe("old reference")

      yield* catalog.pull([{ name: "deploy", version: "3", files: ["SKILL.md"] }], {
        "/catalog/deploy/SKILL.md": "# New",
      })
      expect(yield* Effect.promise(() => Bun.file(path.join(root, "SKILL.md")).text())).toBe("# New")
      expect(yield* Effect.promise(() => Bun.file(path.join(root, "old.md")).exists())).toBe(false)
    }),
  )

  it.effect(
    "gives up on a catalog or a file download that never answers",
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
      const base = "https://skills.example.test/catalog/"
      for (const hanging of [`${base}index.json`, `${base}deploy/SKILL.md`]) {
        const http = HttpClient.make((request) =>
          request.url === hanging
            ? Effect.never
            : Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json({ skills: [{ name: "deploy", version: hanging, files: ["SKILL.md"] }] }),
                ),
              ),
        )
        const pull = yield* Effect.gen(function* () {
          const discovery = yield* SkillDiscovery.Service
          return yield* discovery.pull(base)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(SkillDiscovery.node, [
              Global.node.replace(Global.layerWith({ cache: tmp.path })),
              httpClient.replace(Layer.succeed(HttpClient.HttpClient, http)),
            ]),
          ),
          Effect.forkChild({ startImmediately: true }),
        )
        yield* advance(() => pull.pollUnsafe() !== undefined)
        expect(yield* Fiber.join(pull)).toEqual([])
      }
    }),
  )
})
