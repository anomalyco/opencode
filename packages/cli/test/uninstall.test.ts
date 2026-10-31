import { log } from "@clack/prompts"
import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, spyOn } from "bun:test"
import { Effect, FileSystem, Logger } from "effect"
import path from "node:path"
import uninstall from "../src/commands/handlers/uninstall"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)
;[false, true].forEach((fallback) => {
  it.live("uninstall shows cleanup instructions only when a retained folder is reported: " + fallback, () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-uninstall-" })
      const global = Global.make(
        Object.fromEntries(
          ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [
            key,
            path.join(root, key),
          ]),
        ),
      )
      const directory = path.join(root, "npm prefix", ".opencode", "retained-images")
      const warning = yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(log, "warn").mockImplementation(() => {})),
        (spy) => Effect.sync(() => spy.mockRestore()),
      )
      const unused = Effect.die("Unexpected updater operation")
      yield* uninstall({ force: true, dryRun: false }).pipe(
        Effect.provideService(Global.Service, global),
        Effect.provideService(Updater.Service, {
          run: () => unused,
          check: () => unused,
          apply: () => unused,
          method: () => Effect.succeed("npm"),
          latest: () => unused,
          upgrade: () => unused,
          removal: () => ({
            command: ["npm", "uninstall", "--global", "@opencode/cli"],
            run: Effect.succeed({ retainedDirectory: fallback ? directory : undefined }),
          }),
        }),
        Effect.provide(Logger.layer([])),
      )
      // This must reach the normal CLI UI even when diagnostic logging is disabled.
      expect(warning.mock.calls).toEqual(
        fallback
          ? [["Retained executables may remain in " + directory + "; remove them after all OpenCode processes exit."]]
          : [],
      )
    }),
  )
})
