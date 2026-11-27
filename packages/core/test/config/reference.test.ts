import path from "path"
import { describe, expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { ConfigReferencePlugin } from "@opencode/core/config/plugin/reference"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Reference } from "@opencode/core/reference"
import { RepositoryCache } from "@opencode/core/repository-cache"
import { AbsolutePath } from "@opencode/core/schema"
import { Document, Info } from "@opencode/schema/config"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { makePluginTestLayer } from "../plugin/fixture"

const decode = Schema.decodeUnknownSync(Info)
const cache = Layer.succeed(RepositoryCache.Service, {
  ensure: (input) =>
    Effect.succeed({
      repository: input.reference.label,
      host: input.reference.host,
      remote: input.reference.remote,
      localPath: "",
      status: "cached" as const,
    }),
})
const it = testEffect(makePluginTestLayer(undefined, undefined, [RepositoryCache.node.replace(cache)]))

const configRoot = path.resolve("/workspace/config")
const configFile = path.join(configRoot, "opencode.json")
const home = path.resolve("/workspace/home")

function load(references: Record<string, unknown>) {
  return Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const service = yield* Reference.Service
    const host = yield* PluginHost.make(plugins, "test")
    yield* ConfigReferencePlugin.Plugin.effect(host)
    return yield* service.list()
  }).pipe(
    Effect.provide(
      Config.testLayer([
        new Document({
          type: "document",
          path: AbsolutePath.make(configFile),
          info: decode({ references }),
        }),
      ]),
    ),
    Effect.provide(Global.layerWith({ home })),
  )
}

describe("ConfigReferencePlugin.Plugin", () => {
  // `~\` is the native form on Windows; elsewhere both spellings are `~/`.
  for (const separator of new Set(["/", path.sep])) {
    it.effect(`expands home-relative paths written as ~ and ~${separator}docs`, () =>
      Effect.gen(function* () {
        const items = yield* load({
          home: "~",
          homeObj: { path: "~" },
          docs: `~${separator}docs`,
          docsObj: { path: `~${separator}docs` },
        })
        const byName = new Map(items.map((item) => [item.name, item]))

        expect(byName.get("home")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(home) }),
        )
        expect(byName.get("homeObj")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(home) }),
        )
        expect(byName.get("docs")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(path.join(home, "docs")) }),
        )
        expect(byName.get("docsObj")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(path.join(home, "docs")) }),
        )
      }),
    )
  }

  it.effect("treats absolute shorthand paths as local references while keeping Git remotes as Git sources", () =>
    Effect.gen(function* () {
      const absolute = path.resolve(configRoot, "..", "shared-docs")
      const entries: Record<string, unknown> = {
        absolute,
        relative: "./local-docs",
        github: "owner/repo",
        prefixed: "github:owner/repo",
        https: "https://github.com/owner/repo",
        scp: "git@github.com:owner/repo.git",
        ...(process.platform === "win32"
          ? {
              winDrive: "C:\\work\\docs",
              winForward: "D:/work/docs",
              winUnc: "\\\\server\\share\\docs",
            }
          : {}),
      }

      const items = yield* load(entries)
      const byName = new Map(items.map((item) => [item.name, item]))

      expect(byName.get("absolute")?.source).toEqual(
        Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(absolute) }),
      )
      expect(byName.get("relative")?.source).toEqual(
        Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(path.join(configRoot, "local-docs")) }),
      )
      expect(byName.get("github")?.source.type).toBe("git")
      expect(byName.get("prefixed")?.source.type).toBe("git")
      expect(byName.get("https")?.source.type).toBe("git")
      expect(byName.get("scp")?.source.type).toBe("git")

      if (process.platform === "win32") {
        expect(byName.get("winDrive")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("C:\\work\\docs") }),
        )
        expect(byName.get("winForward")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("D:\\work\\docs") }),
        )
        expect(byName.get("winUnc")?.source).toEqual(
          Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("\\\\server\\share\\docs") }),
        )
      }
    }),
  )
})
