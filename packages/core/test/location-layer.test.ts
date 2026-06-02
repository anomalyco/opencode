import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { AppFileSystem } from "../src/filesystem"
import { Auth } from "../src/auth"
import { EventV2 } from "../src/event"
import { Global } from "../src/global"
import { ModelsDev } from "../src/models-dev"
import { Npm } from "../src/npm"
import { Project } from "../src/project"
import { ProjectReference } from "../src/project-reference"

const it = testEffect(
  LocationServiceMap.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Project.defaultLayer,
        EventV2.defaultLayer,
        Auth.defaultLayer,
        Npm.defaultLayer,
        ModelsDev.defaultLayer,
        AppFileSystem.defaultLayer,
        Global.defaultLayer,
      ),
    ),
  ),
)

describe("LocationServiceMap", () => {
  it.live("isolates location state while sharing location policy with catalog", () =>
    Effect.acquireRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      (dirs) => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]())).then(() => undefined)),
    ).pipe(
      Effect.flatMap(([blocked, allowed]) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(blocked.path, "opencode.json"),
              JSON.stringify({
                experimental: { policies: [{ effect: "deny", action: "provider.use", resource: "test" }] },
              }),
            ),
          )

          const update = (directory: string) =>
            Effect.gen(function* () {
              yield* PluginBoot.Service.use((boot) => boot.wait())
              yield* ProjectReference.Service
              const catalog = yield* Catalog.Service
              const transform = yield* catalog.transform()
              yield* transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))
              return yield* catalog.provider.all()
            }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.get({ directory: AbsolutePath.make(directory) })))

          expect((yield* update(blocked.path)).some((provider) => provider.id === ProviderV2.ID.make("test"))).toBe(
            false,
          )
          expect((yield* update(allowed.path)).some((provider) => provider.id === ProviderV2.ID.make("test"))).toBe(
            true,
          )
        }),
      ),
    ),
  )
})
