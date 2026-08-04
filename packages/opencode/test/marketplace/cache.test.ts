import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { testEffect } from "../lib/effect"
import * as MarketplaceCache from "@/marketplace/cache"

const layer = LayerNode.compile(LayerNode.group([Database.node, MarketplaceCache.node]))
const it = testEffect(layer)

beforeEach(async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.run(sql`DELETE FROM marketplace_fetch`).pipe(Effect.orDie)
      yield* db.run(sql`DELETE FROM marketplace_materialization`).pipe(Effect.orDie)
      yield* db.run(sql`DELETE FROM marketplace_artifact`).pipe(Effect.orDie)
    }).pipe(Effect.provide(layer)),
  )
})

describe("marketplace content-addressed cache", () => {
  it.effect("deduplicates identical bytes by sha256 digest", () =>
    Effect.gen(function* () {
      const cache = yield* MarketplaceCache.Service
      const bytes = new TextEncoder().encode("same artifact")
      const first = yield* cache.put(bytes, { kind: "test" })
      const second = yield* cache.put(bytes, { kind: "test" })
      expect(first.digest).toBe(second.digest)
      expect(first.path).toBe(second.path)
      expect((yield* cache.summary()).objects).toBe(1)
    }),
  )

  it.effect("loads private GitLab raw files through the API and materializes skill trees", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const seen: string[] = []
        const server = Bun.serve({
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            seen.push(url.href)
            if (request.headers.get("private-token") !== "secret") return new Response("unauthorized", { status: 401 })
            if (url.pathname.endsWith("/repository/tree")) {
              return Response.json([
                { type: "blob", path: "plugins/review/skills/review/SKILL.md" },
                { type: "blob", path: "plugins/review/skills/review/scripts/check.mjs" },
              ])
            }
            if (url.pathname.includes("/repository/files/") && url.pathname.endsWith("/raw")) {
              const file = decodeURIComponent(url.pathname.split("/repository/files/")[1]!.slice(0, -"/raw".length))
              if (file.endsWith("SKILL.md")) {
                return new Response("---\nname: review\ndescription: Review changes\n---\nReview the current diff.")
              }
              if (file.endsWith("scripts/check.mjs")) return new Response("export const check = true")
            }
            return new Response("not found", { status: 404 })
          },
        })
        return { server, seen }
      }),
      ({ server, seen }) =>
        Effect.gen(function* () {
          const cache = yield* MarketplaceCache.Service
          const source = {
            id: "gitlab",
            name: "GitLab",
            url: new URL("ai/agent-marketplace", server.url).href,
            trust: "private" as const,
            headers: { "PRIVATE-TOKEN": "secret" },
          }
          const raw = new URL("ai/agent-marketplace/-/raw/HEAD/plugins/review/skills/", server.url).href
          const materialized = yield* cache.materializePlan({ skills: { urls: [raw] } }, source)
          const skill = materialized.plan.skills?.items?.[0]
          expect(skill?.name).toBe("review")
          expect(yield* Effect.promise(() => fs.readFile(path.join(skill!.path!, "SKILL.md"), "utf8"))).toContain(
            "Review the current diff",
          )
          expect(yield* Effect.promise(() => fs.readFile(path.join(skill!.path!, "scripts/check.mjs"), "utf8"))).toBe(
            "export const check = true",
          )
          expect(seen.some((url) => url.includes("/api/v4/projects/ai%2Fagent-marketplace/repository/tree"))).toBe(true)
          expect(seen.some((url) => url.includes("/repository/files/") && url.endsWith("/raw?ref=HEAD"))).toBe(true)
        }),
      ({ server }) => Effect.promise(async () => void (await server.stop(true))),
    ),
  )

  it.effect("materializes remote skill files concurrently", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = { active: 0, max: 0 }
        const files = ["SKILL.md", ...Array.from({ length: 7 }, (_, index) => `references/${index}.md`)]
        const server = Bun.serve({
          port: 0,
          async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/index.json") {
              return Response.json({ skills: [{ name: "cloudflare", files }] })
            }
            if (url.pathname.startsWith("/cloudflare/")) {
              state.active++
              state.max = Math.max(state.max, state.active)
              await Bun.sleep(25)
              state.active--
              return new Response(
                url.pathname.endsWith("SKILL.md") ? "---\nname: cloudflare\n---\nCloudflare" : "Guide",
              )
            }
            return new Response("not found", { status: 404 })
          },
        })
        return { server, state }
      }),
      ({ server, state }) =>
        Effect.gen(function* () {
          const cache = yield* MarketplaceCache.Service
          const materialized = yield* cache.materializePlan(
            { skills: { urls: [server.url.href] } },
            { id: "remote", name: "Remote", url: new URL("catalog.json", server.url).href, trust: "community" },
          )

          expect(state.max).toBeGreaterThan(1)
          expect(materialized.plan.skills?.items?.[0]?.name).toBe("cloudflare")
          expect(
            yield* Effect.promise(() =>
              fs.readFile(path.join(materialized.plan.skills!.items![0]!.path!, "references", "0.md"), "utf8"),
            ),
          ).toBe("Guide")
        }),
      ({ server }) => Effect.promise(async () => void (await server.stop(true))),
    ),
  )

  it.effect("reads local sources and materializes local plugins, skills, and instructions", () =>
    Effect.acquireUseRelease(
      Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-cache-"))),
      (root) =>
        Effect.gen(function* () {
          const catalog = path.join(root, "marketplace.json")
          const plugin = path.join(root, "plugin.ts")
          const skill = path.join(root, "skills", "review", "SKILL.md")
          const instruction = path.join(root, "review.md")
          const icon = path.join(root, "icon.png")
          yield* Effect.tryPromise(async () => {
            await fs.mkdir(path.dirname(skill), { recursive: true })
            await fs.writeFile(catalog, '{"version":1}')
            await fs.writeFile(plugin, "export const MarketplacePlugin = async () => ({})")
            await fs.writeFile(skill, "---\nname: review\ndescription: Review changes\n---\nReview the current diff.")
            await fs.writeFile(instruction, "Always review the current diff.")
            await fs.writeFile(icon, "local icon")
          })

          const cache = yield* MarketplaceCache.Service
          const first = yield* cache.fetchResponse({
            url: pathToFileURL(catalog).href,
            mode: "refresh",
            kind: "catalog",
          })
          expect(yield* Effect.promise(() => first.text())).toBe('{"version":1}')
          yield* Effect.tryPromise(() => fs.writeFile(catalog, '{"version":2}'))
          const cached = yield* cache.fetchResponse({ url: pathToFileURL(catalog).href, kind: "catalog" })
          expect(yield* Effect.promise(() => cached.text())).toBe('{"version":1}')
          const refreshed = yield* cache.fetchResponse({
            url: pathToFileURL(catalog).href,
            mode: "refresh",
            kind: "catalog",
          })
          expect(yield* Effect.promise(() => refreshed.text())).toBe('{"version":2}')
          expect(
            yield* cache.dataURL({
              url: pathToFileURL(icon).href,
              source: {
                id: "local",
                name: "Local",
                url: pathToFileURL(catalog).href,
                trust: "private",
              },
            }),
          ).toBe("data:image/png;base64,bG9jYWwgaWNvbg==")

          const materialized = yield* cache.materializePlan(
            {
              plugins: [pathToFileURL(plugin).href],
              skills: {
                items: [{ id: "review", name: "review", url: pathToFileURL(path.dirname(skill)).href + "/" }],
              },
              mcp: { review_tools: { type: "local", command: [process.execPath, pathToFileURL(plugin).href] } },
              instructions: [pathToFileURL(instruction).href],
            },
            {
              id: "local",
              name: "Local",
              url: pathToFileURL(catalog).href,
              trust: "private",
            },
          )

          const pluginSpec = materialized.plan.plugins?.[0]
          expect(typeof pluginSpec).toBe("string")
          expect(yield* Effect.promise(() => fs.readFile(fileURLToPath(pluginSpec as string), "utf8"))).toContain(
            "MarketplacePlugin",
          )
          const skillItem = materialized.plan.skills?.items?.[0]
          expect(skillItem?.url).toBeUndefined()
          expect(yield* Effect.promise(() => fs.readFile(path.join(skillItem!.path!, "SKILL.md"), "utf8"))).toContain(
            "Review the current diff",
          )
          const mcpCommand = materialized.plan.mcp?.review_tools?.command
          if (!Array.isArray(mcpCommand)) throw new Error("Expected a materialized MCP command")
          expect(mcpCommand?.[1]?.startsWith(root)).toBe(false)
          expect(yield* Effect.promise(() => fs.readFile(String(mcpCommand?.[1]), "utf8"))).toContain(
            "MarketplacePlugin",
          )
          const materializedInstruction = materialized.plan.instructions?.[0]
          expect(materializedInstruction?.startsWith("file:")).toBe(false)
          expect(yield* Effect.promise(() => fs.readFile(materializedInstruction!, "utf8"))).toContain("Always review")
          expect(materialized.artifactDigests.length).toBeGreaterThanOrEqual(3)
        }),
      (root) => Effect.tryPromise(() => fs.rm(root, { recursive: true, force: true })),
    ),
  )

  it.effect("discovers each skill in a local directory without Bun-only file APIs", () =>
    Effect.acquireUseRelease(
      Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-skills-"))),
      (root) =>
        Effect.gen(function* () {
          const skills = path.join(root, "skills")
          yield* Effect.tryPromise(async () => {
            await fs.mkdir(path.join(skills, "review"), { recursive: true })
            await fs.mkdir(path.join(skills, "release"), { recursive: true })
            await fs.writeFile(path.join(skills, "review", "SKILL.md"), "---\nname: review\n---\nReview changes")
            await fs.writeFile(path.join(skills, "release", "SKILL.md"), "---\nname: release\n---\nPrepare release")
          })

          const cache = yield* MarketplaceCache.Service
          const url = `${pathToFileURL(skills).href}/`
          const materialized = yield* cache.materializePlan(
            { skills: { urls: [url] } },
            { id: "local", name: "Local", url: `${pathToFileURL(root).href}/`, trust: "private" },
          )

          expect(materialized.plan.skills?.urls).toBeUndefined()
          expect(materialized.plan.skills?.items?.map((item) => item.name).toSorted()).toEqual(["release", "review"])
          expect(materialized.plan.skills?.items?.every((item) => item.path && !item.url)).toBe(true)
        }),
      (root) => Effect.tryPromise(() => fs.rm(root, { recursive: true, force: true })),
    ),
  )

  it.effect("prevents network catalogs and local path escapes from reading file artifacts", () =>
    Effect.acquireUseRelease(
      Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-boundary-"))),
      (root) =>
        Effect.gen(function* () {
          const sourceRoot = path.join(root, "source")
          const catalog = path.join(sourceRoot, "marketplace.json")
          const outside = path.join(root, "outside.md")
          const linked = path.join(sourceRoot, "linked.md")
          yield* Effect.tryPromise(async () => {
            await fs.mkdir(sourceRoot, { recursive: true })
            await fs.writeFile(catalog, "{}")
            await fs.writeFile(outside, "must not be loaded")
            await fs.symlink(outside, linked)
          })

          const cache = yield* MarketplaceCache.Service
          const fileURL = pathToFileURL(outside).href
          const escaped = yield* cache
            .materializePlan(
              { instructions: [fileURL] },
              { id: "local", name: "Local", url: pathToFileURL(catalog).href, trust: "private" },
            )
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(escaped?.message).toContain("escapes its source directory")

          const remote = yield* cache
            .materializePlan(
              { instructions: [fileURL] },
              { id: "remote", name: "Remote", url: "https://example.test/marketplace.json", trust: "community" },
            )
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(remote?.message).toContain("cannot reference local file")

          const symlink = yield* cache
            .materializePlan(
              { instructions: [pathToFileURL(linked).href] },
              { id: "local", name: "Local", url: pathToFileURL(catalog).href, trust: "private" },
            )
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(symlink?.message).toContain("symbolic links")
        }),
      (root) => Effect.tryPromise(() => fs.rm(root, { recursive: true, force: true })),
    ),
  )

  it.effect("never serves stale executable content after an authorization or not-found response", () => {
    const state = { status: 200 }
    return Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch() {
            return new Response(state.status === 200 ? "trusted" : "blocked", { status: state.status })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const cache = yield* MarketplaceCache.Service
          const url = new URL("plugin.ts", server.url).href
          yield* cache.fetchResponse({ url, kind: "plugin-file", mode: "refresh" })

          state.status = 404
          const missing = yield* cache
            .fetchResponse({ url, kind: "plugin-file", mode: "refresh" })
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(missing?.message).toContain("HTTP 404")

          state.status = 503
          const stale = yield* cache.fetchResponse({ url, kind: "plugin-file", mode: "refresh" })
          expect(stale.headers.get("x-opencode-cache")).toBe("stale")

          const strict = yield* cache
            .fetchResponse({ url, kind: "plugin-file", mode: "strict" })
            .pipe(Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }))
          expect(strict?.message).toContain("HTTP 503")
        }),
      (server) => Effect.promise(async () => void (await server.stop(true))),
    )
  })

  it.effect("strips credentials on cross-origin redirects", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const seen = { authorization: undefined as string | undefined }
        const target = Bun.serve({
          port: 0,
          fetch(request) {
            seen.authorization = request.headers.get("authorization") ?? undefined
            return new Response("artifact")
          },
        })
        const redirect = Bun.serve({
          port: 0,
          fetch() {
            return Response.redirect(new URL("artifact", target.url), 302)
          },
        })
        return { seen, target, redirect }
      }),
      (servers) =>
        Effect.gen(function* () {
          const cache = yield* MarketplaceCache.Service
          const response = yield* cache.fetchResponse({
            url: new URL("redirect", servers.redirect.url).href,
            headers: { authorization: "Bearer secret" },
            mode: "strict",
          })
          expect(yield* Effect.promise(() => response.text())).toBe("artifact")
          expect(servers.seen.authorization).toBeUndefined()
        }),
      (servers) =>
        Effect.promise(async () => {
          await servers.redirect.stop(true)
          await servers.target.stop(true)
        }),
    ),
  )

  it.effect("materializes a remote skill into an immutable local tree", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            if (url.pathname.endsWith("/index.json")) return new Response("not found", { status: 404 })
            if (url.pathname.endsWith("/skill.md")) {
              return new Response("---\nname: review\ndescription: Review changes\n---\nReview the current diff.", {
                headers: { "content-type": "text/markdown" },
              })
            }
            return new Response("not found", { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const cache = yield* MarketplaceCache.Service
          const url = new URL("skill.md", server.url).href
          const materialized = yield* cache.materializePlan(
            {
              skills: {
                items: [{ id: "review", name: "review", url }],
              },
            },
            {
              id: "local",
              name: "Local",
              url: new URL("catalog.json", server.url).href,
              trust: "private",
            },
          )
          const item = materialized.plan.skills?.items?.[0]
          expect(item?.url).toBeUndefined()
          expect(item?.path).toBeDefined()
          expect(yield* Effect.promise(() => fs.readFile(`${item!.path}/SKILL.md`, "utf8"))).toContain(
            "Review the current diff",
          )
          expect(materialized.treeDigest).toMatch(/^sha256:/)
          expect(materialized.artifactDigests.length).toBeGreaterThan(0)
        }),
      (server) => Effect.promise(async () => void (await server.stop(true))),
    ),
  )
})
