import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import fs from "fs/promises"
import path from "path"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
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
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
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
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
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
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
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
    ),
  )

  it.live("all() returns empty object when auth.json is corrupted JSON instead of throwing", () =>
    // Regression: a half-written or otherwise corrupted auth.json used to crash Auth.all().
    // The fix routes the JSON.parse defect through readJson's Effect error channel so the
    // subsequent Effect.orElseSucceed recovers to an empty record.
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const file = path.join(Global.Path.data, "auth.json")
        yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(file, "{ \"anthropic\": { \"type\": \"api\", \"key\":"))

        const data = yield* auth.all()
        expect(data).toEqual({})
      }),
    ),
  )

  it.live("all() returns empty object when auth.json contains binary garbage", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const file = path.join(Global.Path.data, "auth.json")
        yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(file, Buffer.from([0x00, 0xff, 0x00, 0xff, 0x42, 0x42])))

        const data = yield* auth.all()
        expect(data).toEqual({})
      }),
    ),
  )

  it.live("get() returns undefined when auth.json is corrupted (does not throw)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const file = path.join(Global.Path.data, "auth.json")
        yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(file, "not json at all"))

        const got = yield* auth.get("anthropic")
        expect(got).toBeUndefined()
      }),
    ),
  )

  it.live("set() recovers from corrupted auth.json and writes a valid file", () =>
    // After corruption, the user should still be able to log in and have writes persist.
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const file = path.join(Global.Path.data, "auth.json")
        yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(file, "\0\0corrupted\0\0"))

        yield* auth.set("anthropic", { type: "api", key: "sk-test" })

        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        const entry = data["anthropic"]!
        expect(entry.type).toBe("api")
        if (entry.type === "api") expect(entry.key).toBe("sk-test")

        // and the file on disk should now be valid JSON
        const written = yield* Effect.promise(() => fs.readFile(file, "utf8"))
        expect(() => JSON.parse(written)).not.toThrow()
      }),
    ),
  )

  it.live("all() honors OPENCODE_AUTH_CONTENT env var with valid JSON", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        // Wipe any auth.json from previous tests so the env-var path is the only source.
        const file = path.join(Global.Path.data, "auth.json")
        yield* Effect.promise(() => fs.rm(file, { force: true }))

        const previous = process.env.OPENCODE_AUTH_CONTENT
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
          anthropic: { type: "api", key: "sk-from-env" },
        })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_AUTH_COxNTENT
            else process.env.OPENCODE_AUTH_CONTENT = previous
          }),
        )

        const auth = yield* Auth.Service
        const data = yield* auth.all()
        const entry = data["anthropic"]
        expect(entry).toBeDefined()
        expect(entry!.type).toBe("api")
        if (entry!.type === "api") expect(entry!.key).toBe("sk-from-env")
      }),
    ),
  )
})
