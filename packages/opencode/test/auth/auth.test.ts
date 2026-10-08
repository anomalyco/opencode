import { describe, expect } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { Filesystem } from "@/util/filesystem"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

describe("Auth", () => {
  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeDefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "old",
      })
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("example.com"))
      expect(keys).toEqual(["https://example.com"])
      const entry = data["https://example.com"]!
      expect(entry.type).toBe("wellknown")
      if (entry.type === "wellknown") expect(entry.token).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      yield* auth.remove("https://example.com/")
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeUndefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["anthropic"]).toBeDefined()
      yield* auth.remove("anthropic")
      const after = yield* auth.all()
      expect(after["anthropic"]).toBeUndefined()
    }),
  )

  // A mutation must not drop credentials the running build cannot decode.
  // `all()` filters those out for reads, and the old `set`/`remove` wrote back
  // the filtered map, so a single mutation permanently deleted every entry
  // whose JSON shape this build did not recognize (see #42387).
  it.instance("set and remove preserve entries the current build cannot decode", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const original = yield* Effect.promise(() => Filesystem.readText(file).catch(() => undefined))
      yield* Effect.promise(() =>
        Filesystem.write(
          file,
          JSON.stringify({
            anthropic: { type: "api", key: "keep-me" },
            "future-provider": { type: "something-new", secret: "opaque", version: 99 },
          }),
        ),
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          if (original !== undefined) await Filesystem.write(file, original)
          else await unlink(file).catch(() => undefined)
        }),
      )

      // set: the undecodable entry must survive, the valid one stay intact.
      yield* auth.set("openai", { type: "api", key: "new-key" })
      const afterSet = JSON.parse(yield* Effect.promise(() => Filesystem.readText(file)))
      expect(afterSet["anthropic"]).toEqual({ type: "api", key: "keep-me" })
      expect(afterSet["future-provider"]).toEqual({ type: "something-new", secret: "opaque", version: 99 })
      expect(afterSet["openai"]).toEqual({ type: "api", key: "new-key" })

      // remove (the `auth logout` path from the issue): removing one key must
      // not take the undecodable entry with it.
      yield* auth.remove("anthropic")
      const afterRemove = JSON.parse(yield* Effect.promise(() => Filesystem.readText(file)))
      expect(afterRemove["anthropic"]).toBeUndefined()
      expect(afterRemove["future-provider"]).toEqual({ type: "something-new", secret: "opaque", version: 99 })

      // and reads still ignore the undecodable entry
      const all = yield* auth.all()
      expect(all["anthropic"]).toBeUndefined()
      expect(all["future-provider"]).toBeUndefined()
    }),
  )
})
