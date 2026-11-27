import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Schema } from "effect"
import type { ReferenceEditor } from "@opencode/plugin/effect/reference"
import { Document, Info } from "@opencode/schema/config"
import { Config } from "@opencode/core/config"
import { ConfigReferencePlugin } from "@opencode/core/config/plugin/reference"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Global.node])))
const decode = Schema.decodeUnknownSync(Info)
const home = path.resolve("home")
const configDirectory = path.resolve("config")

describe("ConfigReferencePlugin.Plugin", () => {
  it.effect("expands ~, ~/ and, on Windows, ~\\ in local references", () =>
    Effect.gen(function* () {
      const sources = yield* load({
        home: "~",
        homeDocs: "~/docs",
        backslash: "~\\docs",
        object: { path: "~\\docs" },
      })
      expect(sources.home).toEqual({ type: "local", path: home })
      expect(sources.homeDocs).toEqual({ type: "local", path: path.join(home, "docs") })
      // `~\` is a home path only on Windows; elsewhere it is an ordinary relative name.
      const backslash = process.platform === "win32" ? path.join(home, "docs") : path.join(configDirectory, "~\\docs")
      expect(sources.backslash).toEqual({ type: "local", path: backslash })
      expect(sources.object).toEqual({ type: "local", path: backslash })
    }),
  )

  it.effect("treats Windows drive and UNC paths as local on Windows", () =>
    Effect.gen(function* () {
      const sources = yield* load({
        backslash: "C:\\work\\docs",
        forward: "D:/work/docs",
        unc: "\\\\server\\share\\docs",
        scp: "git@github.com:anomalyco/opencode.git",
      })
      expect(sources.scp).toMatchObject({ type: "git", repository: "git@github.com:anomalyco/opencode.git" })
      if (process.platform !== "win32") {
        // On POSIX these are not absolute paths, so `D:/work/docs` keeps its SCP-like reading.
        expect(sources.forward).toMatchObject({ type: "git" })
        return
      }
      expect(sources.backslash).toEqual({ type: "local", path: "C:\\work\\docs" })
      expect(sources.forward).toEqual({ type: "local", path: "D:\\work\\docs" })
      expect(sources.unc).toEqual({ type: "local", path: "\\\\server\\share\\docs" })
    }),
  )
})

function load(references: Record<string, unknown>) {
  return Effect.gen(function* () {
    const added: Record<string, unknown> = {}
    const editor: ReferenceEditor = {
      add: (name, source) => {
        added[name] = source
      },
      remove: () => {},
      list: () => [],
      get: () => undefined,
    }
    const global = yield* Global.Service
    yield* ConfigReferencePlugin.Plugin.effect(
      host({
        reference: {
          list: () => Effect.die("unused reference.list"),
          transform: (callback) =>
            Effect.sync(() => {
              callback(editor)
              return { dispose: Effect.void }
            }),
          reload: () => Effect.void,
        },
      }),
    ).pipe(
      Effect.provide(
        Config.testLayer([
          new Document({
            type: "document",
            path: AbsolutePath.make(path.join(configDirectory, "opencode.json")),
            info: decode({ references }),
          }),
        ]),
      ),
      Effect.provideService(Global.Service, Global.Service.of({ ...global, home })),
      Effect.provideService(
        Location.Service,
        Location.Service.of({
          directory: AbsolutePath.make(configDirectory),
          project: {
            id: Project.ID.global,
            directory: AbsolutePath.make(configDirectory),
            canonical: AbsolutePath.make(configDirectory),
          },
        }),
      ),
      Effect.scoped,
    )
    return added
  })
}
