import fs from "fs/promises"
import path from "path"
import { createServer } from "node:http"
import { describe, expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const fixture = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir()))
  const state: {
    skills: unknown[]
    files: Record<string, string>
    requests: string[]
  } = { skills: [], files: {}, requests: [] }
  const server = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0 })
  const base = new URL("/catalog/", HttpServer.formatAddress(server.address)).href
  yield* server.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, base)
      state.requests.push(url.href)
      const body =
        url.pathname === "/catalog/index.json" ? JSON.stringify({ skills: state.skills }) : state.files[url.pathname]
      return HttpServerResponse.text(body ?? "Not Found", { status: body === undefined ? 404 : 200 })
    }),
  )
  return {
    cache: tmp.path,
    base,
    pull: (skills: unknown[], files: Record<string, string> = {}) =>
      Effect.gen(function* () {
        state.skills = skills
        state.files = files
        state.requests = []
        // Rebuild per pull so repeated calls exercise the disk cache, not a shared service.
        const directories = yield* Effect.gen(function* () {
          const discovery = yield* SkillDiscovery.Service
          return yield* discovery.pull(base)
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(SkillDiscovery.node, [[Global.node, Global.layerWith({ cache: tmp.path })]]),
          ),
        )
        return { directories, requests: state.requests.slice() }
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
})
