import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import * as Marketplace from "@/marketplace"
import * as Registry from "@/marketplace/registry"
import * as Source from "@/marketplace/source"
import * as Install from "@/marketplace/install"
import type { PackageEntry } from "@/marketplace/types"
import { testEffect } from "../lib/effect"

async function writeFile(dir: string, rel: string, content: string) {
  const fp = path.join(dir, rel)
  await import("fs/promises").then((f) => f.mkdir(path.dirname(fp), { recursive: true }))
  await import("fs/promises").then((f) => f.writeFile(fp, content))
}

async function mkdir(dir: string) {
  await import("fs/promises").then((f) => f.mkdir(dir, { recursive: true }))
}

function tmpdirEffect() {
  return Effect.acquireRelease(
    Effect.promise(async (): Promise<string> => {
      const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
      await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
      return await import("fs/promises").then((f) => f.realpath(d))
    }),
    (dir) =>
      Effect.promise(() =>
        import("fs/promises").then((f) =>
          f.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined),
        ),
      ),
  )
}

function testGlobal(paths: { config: string; state: string; cache: string }) {
  return Layer.succeed(Global.Service, Global.Service.of(Global.make(paths)))
}

const fsLayer = FSUtil.defaultLayer

describe("Registry", () => {
  const it = testEffect(
    Registry.layer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(fsLayer),
      Layer.provide(Global.defaultLayer),
    ),
  )

  it.live("scanLocal returns empty for missing directory", () =>
    Effect.gen(function* () {
      const svc = yield* Registry.Service
      const result = yield* svc.scanLocal("/nonexistent")
      expect(result).toEqual([])
    }),
  )

  it.live("scanLocal reads index.json with package entries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* tmpdirEffect()
        yield* Effect.promise(() => writeFile(dir, "index.json", JSON.stringify({
          packages: [
            { name: "test-pkg", source: { type: "url", url: "https://example.com/pkg" } },
            { name: "local-pkg", source: { type: "local", path: "./skills" } },
          ],
        })))

        const svc = yield* Registry.Service
        const result = yield* svc.scanLocal(dir)
        expect(result).toHaveLength(2)
        expect(result[0].name).toBe("test-pkg")
        expect(result[1].name).toBe("local-pkg")
      }),
    ),
  )

  it.live("scanLocal resolves relative local paths", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* tmpdirEffect()
        yield* Effect.promise(() => writeFile(dir, "index.json", JSON.stringify({
          packages: [
            { name: "local-pkg", source: { type: "local", path: "./my-skills" } },
          ],
        })))

        const svc = yield* Registry.Service
        const result = yield* svc.scanLocal(dir)
        expect((result[0].source as Record<string, unknown>).path).toContain("/my-skills")
      }),
    ),
  )

  it.live("scanLocal returns empty for invalid json", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* tmpdirEffect()
        yield* Effect.promise(() => writeFile(dir, "index.json", "not json"))

        const svc = yield* Registry.Service
        const result = yield* svc.scanLocal(dir)
        expect(result).toEqual([])
      }),
    ),
  )
})

describe("Install", () => {
  const baseLayer = Install.layer.pipe(
    Layer.provide(fsLayer),
    Layer.provide(Global.defaultLayer),
  )

  describe("discover", () => {
    const it = testEffect(baseLayer)

    it.live("discovers SKILL.md files", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirEffect()
          yield* Effect.promise(() => writeFile(dir, "my-skill/SKILL.md", "# My Skill"))
          yield* Effect.promise(() => writeFile(dir, "another-skill/SKILL.md", "# Another Skill"))

          const svc = yield* Install.Service
          const assets = yield* svc.discover(dir)
          expect(assets.skills).toHaveLength(2)
          expect(assets.skills[0]).toMatch(/SKILL\.md$/)
        }),
      ),
    )

    it.live("discovers nested SKILL.md files", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirEffect()
          yield* Effect.promise(() => writeFile(dir, "group/my-skill/SKILL.md", "# Nested"))
          yield* Effect.promise(() => writeFile(dir, "standalone/SKILL.md", "# Standalone"))

          const svc = yield* Install.Service
          const assets = yield* svc.discover(dir)
          expect(assets.skills).toHaveLength(2)
        }),
      ),
    )

    it.live("discovers agents", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirEffect()
          yield* Effect.promise(() => writeFile(dir, "agents/my-agent.md", "# Agent"))

          const svc = yield* Install.Service
          const assets = yield* svc.discover(dir)
          expect(assets.agents).toHaveLength(1)
        }),
      ),
    )

    it.live("discovers plugins via package.json exports", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirEffect()
          yield* Effect.promise(() =>
            writeFile(dir, "package.json", JSON.stringify({ exports: { "./server": "./server.js" } })),
          )

          const svc = yield* Install.Service
          const assets = yield* svc.discover(dir)
          expect(assets.plugins).toHaveLength(1)
        }),
      ),
    )

    it.live("returns empty assets for empty directory", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dir = yield* tmpdirEffect()
          const svc = yield* Install.Service
          const assets = yield* svc.discover(dir)
          expect(assets.skills).toEqual([])
          expect(assets.agents).toEqual([])
          expect(assets.plugins).toEqual([])
        }),
      ),
    )
  })

  describe("install and uninstall", () => {
    const it = testEffect(baseLayer)

    function installLayer(configDir: string) {
      return Install.layer.pipe(
        Layer.provide(fsLayer),
        Layer.provide(testGlobal({ config: configDir, state: configDir, cache: "/tmp" })),
      )
    }

    async function withConfigDir<R>(fn: (dirs: { src: string; config: string }) => Promise<R>) {
      const src = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()
      const config = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()
      try {
        return await fn({ src, config })
      } finally {
        await Promise.all([
          import("fs/promises").then((f) => f.rm(src, { recursive: true, force: true }).catch(() => undefined)),
          import("fs/promises").then((f) => f.rm(config, { recursive: true, force: true }).catch(() => undefined)),
        ])
      }
    }

    test("copies full skill directory to config", async () => {
      await withConfigDir(async ({ src, config }) => {
        await writeFile(src, "my-skill/SKILL.md", "# Skill")
        await writeFile(src, "my-skill/scripts/run.sh", "echo hello")
        await writeFile(src, "my-skill/references/guide.md", "# Guide")
        await mkdir(path.join(config, "skills", "test-pkg"))

        await Effect.runPromise(
          Effect.gen(function* () {
            const s = yield* Install.Service
            const r = yield* s.install("test-pkg", src)
            expect(r.assets.skills).toHaveLength(1)
          }).pipe(Effect.provide(
            Install.layer.pipe(
              Layer.provide(fsLayer),
              Layer.provide(testGlobal({ config, state: config, cache: "/tmp" })),
            ),
          )),
        )

        const skillDir = path.join(config, "skills", "test-pkg", "my-skill")
        const exists = await import("fs/promises").then((f) =>
          f.stat(skillDir).then(() => true).catch(() => false),
        )
        expect(exists).toBe(true)

        const f = await import("fs/promises")
        const all: string[] = []
        async function walk(dir: string, prefix: string) {
          const entries = await f.readdir(dir, { withFileTypes: true })
          for (const e of entries) {
            const r = prefix ? `${prefix}/${e.name}` : e.name
            if (e.isDirectory()) await walk(path.join(dir, e.name), r)
            else all.push(r)
          }
        }
        await walk(skillDir, "")
        expect(all).toContain("SKILL.md")
        expect(all).toContain("scripts/run.sh")
        expect(all).toContain("references/guide.md")
      })
    })

    test("uninstalls removes skill directory", async () => {
      await withConfigDir(async ({ src, config }) => {
        await writeFile(src, "my-skill/SKILL.md", "# Skill")
        await mkdir(path.join(config, "skills", "test-pkg"))

        await Effect.runPromise(
          Effect.gen(function* () {
            const s = yield* Install.Service
            const r = yield* s.install("test-pkg", src)
            yield* s.uninstall("test-pkg", r.assets)
          }).pipe(Effect.provide(
            Install.layer.pipe(
              Layer.provide(fsLayer),
              Layer.provide(testGlobal({ config, state: config, cache: "/tmp" })),
            ),
          )),
        )

        const pkgDir = path.join(config, "skills", "test-pkg")
        const exists = await import("fs/promises").then((f) =>
          f.stat(pkgDir).then(() => true).catch(() => false),
        )
        expect(exists).toBe(false)
      })
    })

  })
})

describe("Source", () => {
  const it = testEffect(
    Source.layer.pipe(
      Layer.provide(
        testGlobal({ config: "/tmp", state: "/tmp", cache: "/tmp" }),
      ),
    ),
  )

  it.live("copies a directory to cache", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const srcDir = yield* tmpdirEffect()
        yield* Effect.promise(() => writeFile(srcDir, "skill/SKILL.md", "# Skill"))

        const svc = yield* Source.Service
        const result = yield* svc.fetch("test-pkg", srcDir)
        expect(result.dir).toContain("test-pkg")
        expect(result.sourceUrl).toContain(srcDir)

        const files = yield* Effect.promise(() =>
          import("fs/promises").then((f) => f.readdir(path.join(result.dir, "skill"))),
        )
        expect(files).toContain("SKILL.md")
      }),
    ),
  )

  it.live("reuses existing cache with content", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const srcDir = yield* tmpdirEffect()
        yield* Effect.promise(() => writeFile(srcDir, "skill/SKILL.md", "# Skill"))

        const svc = yield* Source.Service
        const first = yield* svc.fetch("test-pkg", srcDir)
        const second = yield* svc.fetch("test-pkg", srcDir)
        expect(first.dir).toBe(second.dir)
      }),
    ),
  )

  it.live("routes gitlab: prefix to cloneGitLab", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const svc = yield* Source.Service
        const result = yield* svc.fetch("test-gitlab-pkg", "gitlab:user/test-gitlab-pkg")
        // GitLab clone will fail (no network), but reaches cloneGitLab not copyLocal
        expect(result.dir).toBe("")
      }),
    ),
  )

  it.live("replaces stale empty cache directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const srcDir = yield* tmpdirEffect()
        yield* Effect.promise(() => writeFile(srcDir, "skill/SKILL.md", "# Skill"))

        yield* Effect.promise(() =>
          import("fs/promises").then((f) =>
            f.mkdir(path.join("/tmp", "marketplace", "test-pkg"), { recursive: true }),
          ).catch(() => undefined),
        )

        const svc = yield* Source.Service
        const result = yield* svc.fetch("test-pkg", srcDir)
        const files = yield* Effect.promise(() =>
          import("fs/promises").then((f) => f.readdir(result.dir)),
        )
        expect(files.length).toBeGreaterThan(0)
      }),
    ),
  )
})

describe("Marketplace", () => {
  describe("search", () => {
    const mockRegistry = Layer.succeed(Registry.Service, Registry.Service.of({
      all: (query?: string) => {
        const entries: PackageEntry[] = [
          { name: "test-pkg", description: "A test package", version: "1.0.0", source: { type: "github" as const, repo: "user/test-pkg" } },
          { name: "other-pkg", description: "Another package", source: { type: "url" as const, url: "https://example.com/pkg" } },
        ]
        if (!query) return Effect.succeed(entries)
        return Effect.succeed(entries.filter((p) => p.name.includes(query) || p.description?.includes(query)))
      },
      fetchIndex: () => Effect.succeed([]),
      scanLocal: () => Effect.succeed([]),
    }))

    const it = testEffect(
      Marketplace.layer.pipe(
        Layer.provide(mockRegistry),
        Layer.provide(Source.layer),
        Layer.provide(Install.layer),
        Layer.provide(fsLayer),
        Layer.provide(Global.defaultLayer),
      ),
    )

    it.effect("returns all packages without query", () =>
      Effect.gen(function* () {
        const svc = yield* Marketplace.Service
        const result = yield* svc.search("")
        expect(result).toHaveLength(2)
      }),
    )

    it.effect("filters by name", () =>
      Effect.gen(function* () {
        const svc = yield* Marketplace.Service
        const result = yield* svc.search("test")
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("test-pkg")
      }),
    )

    it.effect("filters by description", () =>
      Effect.gen(function* () {
        const svc = yield* Marketplace.Service
        const result = yield* svc.search("another")
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("other-pkg")
      }),
    )

    it.effect("returns empty for no match", () =>
      Effect.gen(function* () {
        const svc = yield* Marketplace.Service
        const result = yield* svc.search("nonexistent")
        expect(result).toEqual([])
      }),
    )
  })

  describe("install, list, info, uninstall", () => {
    test("install records the package", async () => {
      const stateDir = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()

      try {
        const mockRegistry = Layer.succeed(Registry.Service, Registry.Service.of({
          all: () => Effect.succeed([] as PackageEntry[]),
          fetchIndex: () => Effect.succeed([] as PackageEntry[]),
          scanLocal: () => Effect.succeed([] as PackageEntry[]),
        }))

        const mockSource = Layer.succeed(Source.Service, Source.Service.of({
          fetch: () => Effect.succeed({ dir: "/tmp/test-pkg", sourceUrl: "https://github.com/user/test-pkg" }),
        }))

        const mockInstall = Layer.succeed(Install.Service, Install.Service.of({
          discover: () => Effect.succeed(new Install.Assets({ skills: [], agents: [], plugins: [] })),
          install: (_name, installDir) => Effect.succeed({ assets: new Install.Assets({ skills: [], agents: [], plugins: [] }), targetDir: installDir }),
          uninstall: () => Effect.void,
        }))

        const layer = Marketplace.layer.pipe(
          Layer.provide(mockRegistry),
          Layer.provide(mockSource),
          Layer.provide(mockInstall),
          Layer.provide(fsLayer),
          Layer.provide(testGlobal({ config: "/tmp", state: stateDir, cache: "/tmp" })),
        )

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* Marketplace.Service
            yield* svc.install("test-pkg", "github:user/test-pkg")
            return yield* svc.list()
          }).pipe(Effect.provide(layer)),
        )

        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("test-pkg")
      } finally {
        await import("fs/promises").then((f) =>
          f.rm(stateDir, { recursive: true, force: true }).catch(() => undefined),
        )
      }
    })

    test("info returns package details", async () => {
      const stateDir = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()

      try {
        const mockRegistry = Layer.succeed(Registry.Service, Registry.Service.of({
          all: () => Effect.succeed([] as PackageEntry[]),
          fetchIndex: () => Effect.succeed([] as PackageEntry[]),
          scanLocal: () => Effect.succeed([] as PackageEntry[]),
        }))

        const mockSource = Layer.succeed(Source.Service, Source.Service.of({
          fetch: () => Effect.succeed({ dir: "/tmp/test-pkg", sourceUrl: "https://github.com/user/test-pkg" }),
        }))

        const mockInstall = Layer.succeed(Install.Service, Install.Service.of({
          discover: () => Effect.succeed(new Install.Assets({ skills: [], agents: [], plugins: [] })),
          install: (_name, installDir) => Effect.succeed({ assets: new Install.Assets({ skills: [], agents: [], plugins: [] }), targetDir: installDir }),
          uninstall: () => Effect.void,
        }))

        const layer = Marketplace.layer.pipe(
          Layer.provide(mockRegistry),
          Layer.provide(mockSource),
          Layer.provide(mockInstall),
          Layer.provide(fsLayer),
          Layer.provide(testGlobal({ config: "/tmp", state: stateDir, cache: "/tmp" })),
        )

        const info = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* Marketplace.Service
            yield* svc.install("test-pkg", "github:user/test-pkg")
            return yield* svc.info("test-pkg")
          }).pipe(Effect.provide(layer)),
        )

        expect(info).toBeDefined()
        expect(info!.name).toBe("test-pkg")
        expect(info!.sourceUrl).toBe("https://github.com/user/test-pkg")
        expect(typeof info!.installedAt).toBe("number")
      } finally {
        await import("fs/promises").then((f) =>
          f.rm(stateDir, { recursive: true, force: true }).catch(() => undefined),
        )
      }
    })

    test("info returns undefined for missing package", async () => {
      const stateDir = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()

      try {
        const mockRegistry = Layer.succeed(Registry.Service, Registry.Service.of({
          all: () => Effect.succeed([] as PackageEntry[]),
          fetchIndex: () => Effect.succeed([] as PackageEntry[]),
          scanLocal: () => Effect.succeed([] as PackageEntry[]),
        }))

        const mockSource = Layer.succeed(Source.Service, Source.Service.of({
          fetch: () => Effect.succeed({ dir: "/tmp/test-pkg", sourceUrl: "https://github.com/user/test-pkg" }),
        }))

        const mockInstall = Layer.succeed(Install.Service, Install.Service.of({
          discover: () => Effect.succeed(new Install.Assets({ skills: [], agents: [], plugins: [] })),
          install: (_name, installDir) => Effect.succeed({ assets: new Install.Assets({ skills: [], agents: [], plugins: [] }), targetDir: installDir }),
          uninstall: () => Effect.void,
        }))

        const layer = Marketplace.layer.pipe(
          Layer.provide(mockRegistry),
          Layer.provide(mockSource),
          Layer.provide(mockInstall),
          Layer.provide(fsLayer),
          Layer.provide(testGlobal({ config: "/tmp", state: stateDir, cache: "/tmp" })),
        )

        const info = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* Marketplace.Service
            return yield* svc.info("nonexistent")
          }).pipe(Effect.provide(layer)),
        )

        expect(info).toBeUndefined()
      } finally {
        await import("fs/promises").then((f) =>
          f.rm(stateDir, { recursive: true, force: true }).catch(() => undefined),
        )
      }
    })

    test("list returns empty with no installations", async () => {
      const stateDir = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()

      try {
        const mockRegistry = Layer.succeed(Registry.Service, Registry.Service.of({
          all: () => Effect.succeed([] as PackageEntry[]),
          fetchIndex: () => Effect.succeed([] as PackageEntry[]),
          scanLocal: () => Effect.succeed([] as PackageEntry[]),
        }))

        const mockSource = Layer.succeed(Source.Service, Source.Service.of({
          fetch: () => Effect.succeed({ dir: "/tmp/test-pkg", sourceUrl: "https://github.com/user/test-pkg" }),
        }))

        const mockInstall = Layer.succeed(Install.Service, Install.Service.of({
          discover: () => Effect.succeed(new Install.Assets({ skills: [], agents: [], plugins: [] })),
          install: (_name, installDir) => Effect.succeed({ assets: new Install.Assets({ skills: [], agents: [], plugins: [] }), targetDir: installDir }),
          uninstall: () => Effect.void,
        }))

        const layer = Marketplace.layer.pipe(
          Layer.provide(mockRegistry),
          Layer.provide(mockSource),
          Layer.provide(mockInstall),
          Layer.provide(fsLayer),
          Layer.provide(testGlobal({ config: "/tmp", state: stateDir, cache: "/tmp" })),
        )

        const list = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* Marketplace.Service
            return yield* svc.list()
          }).pipe(Effect.provide(layer)),
        )

        expect(list).toEqual([])
      } finally {
        await import("fs/promises").then((f) =>
          f.rm(stateDir, { recursive: true, force: true }).catch(() => undefined),
        )
      }
    })

    test("uninstall removes the package record", async () => {
      const stateDir = await (async () => {
        const d = path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2))
        await import("fs/promises").then((f) => f.mkdir(d, { recursive: true }))
        return await import("fs/promises").then((f) => f.realpath(d))
      })()

      try {
        const mockRegistry = Layer.succeed(Registry.Service, Registry.Service.of({
          all: () => Effect.succeed([] as PackageEntry[]),
          fetchIndex: () => Effect.succeed([] as PackageEntry[]),
          scanLocal: () => Effect.succeed([] as PackageEntry[]),
        }))

        const mockSource = Layer.succeed(Source.Service, Source.Service.of({
          fetch: () => Effect.succeed({ dir: "/tmp/test-pkg", sourceUrl: "https://github.com/user/test-pkg" }),
        }))

        const mockInstall = Layer.succeed(Install.Service, Install.Service.of({
          discover: () => Effect.succeed(new Install.Assets({ skills: [], agents: [], plugins: [] })),
          install: (_name, installDir) => Effect.succeed({ assets: new Install.Assets({ skills: [], agents: [], plugins: [] }), targetDir: installDir }),
          uninstall: () => Effect.void,
        }))

        const layer = Marketplace.layer.pipe(
          Layer.provide(mockRegistry),
          Layer.provide(mockSource),
          Layer.provide(mockInstall),
          Layer.provide(fsLayer),
          Layer.provide(testGlobal({ config: "/tmp", state: stateDir, cache: "/tmp" })),
        )

        await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* Marketplace.Service
            yield* svc.install("test-pkg", "github:user/test-pkg")
            yield* svc.uninstall("test-pkg")
            const list = yield* svc.list()
            expect(list).toEqual([])
          }).pipe(Effect.provide(layer)),
        )
      } finally {
        await import("fs/promises").then((f) =>
          f.rm(stateDir, { recursive: true, force: true }).catch(() => undefined),
        )
      }
    })

  })
})
