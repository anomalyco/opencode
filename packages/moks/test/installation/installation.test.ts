import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { Effect } from "effect"
import path from "path"
import { Installation } from "../../src/installation"
import { InstallationVersion } from "@moks/core/installation/version"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Installation.node))

describe("installation", () => {
  describe("latest", () => {
    it.effect("returns the local version without calling a remote installer", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.latest("unknown")
        expect(result).toBe(InstallationVersion)
      }),
    )
  })

  describe("method", () => {
    it.effect("returns curl only for ~/.moks/bin, never an OpenCode package manager", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.method()
        if (process.execPath.includes(path.join(".moks", "bin"))) {
          expect(result).toBe("curl")
          return
        }
        expect(result).toBe("unknown")
      }),
    )
  })

  describe("upgrade", () => {
    it.effect("fails closed instead of installing a foreign binary", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("npm", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("moks has no binary upgrade; use source install.")
        expect(error.message).toBe(error.stderr)
      }),
    )

    it.effect("rejects curl upgrades that would fetch a foreign installer", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe("moks has no binary upgrade; use source install.")
      }),
    )
  })
})
