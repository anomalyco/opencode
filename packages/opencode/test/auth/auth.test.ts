import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

describe("Auth", () => {
  it.instance("compareAndSet does not claim a corrupt provider entry as absent", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const broken = { type: "api", key: 42 }
      yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ "corrupt-provider": broken })))

      const result = yield* auth.compareAndSet("corrupt-provider", undefined, { type: "api", key: "new" })
      expect(result).toEqual({ written: false, current: undefined })
      const disk = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))) as Record<string, unknown>
      expect(disk["corrupt-provider"]).toEqual(broken)
    }),
  )

  it.instance("compareAndSet compares decoded credentials when stored JSON has extra fields", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      yield* Effect.promise(() =>
        fs.writeFile(file, JSON.stringify({ "decoded-cas": { type: "api", key: "old", extra: "keep until update" } })),
      )
      const expected = yield* auth.getStored("decoded-cas")
      expect(expected).toEqual({ type: "api", key: "old" })
      const result = yield* auth.compareAndSet("decoded-cas", expected, { type: "api", key: "new" })
      expect(result).toEqual({ written: true, current: { type: "api", key: "new" } })
      const disk = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))) as Record<string, unknown>
      expect(disk["decoded-cas"]).toEqual({ type: "api", key: "new" })
    }),
  )

  it.instance("set and compareAndSet reject malformed credentials without changing the file", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      yield* auth.set("validating-provider", { type: "api", key: "original" })
      const before = yield* Effect.promise(() => fs.readFile(file, "utf8"))
      const invalid = { type: "api" } as unknown as Auth.Info
      for (const write of [
        auth.set("validating-provider", invalid),
        auth.compareAndSet("validating-provider", { type: "api", key: "original" }, invalid),
      ]) {
        const result = yield* Effect.exit(write)
        expect(result._tag).toBe("Failure")
        expect(String(result)).toContain("Invalid auth data")
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe(before)
      }
    }),
  )

  it.instance("getStored reads the disk entry rather than an auth environment snapshot", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const previous = process.env.OPENCODE_AUTH_CONTENT
      try {
        yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ stored: { type: "api", key: "disk" } })))
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ stored: { type: "api", key: "snapshot" } })
        expect(yield* auth.getStored("stored")).toEqual({ type: "api", key: "disk" })
      } finally {
        if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
        else process.env.OPENCODE_AUTH_CONTENT = previous
      }
    }),
  )

  it.instance("writes preserve malformed entries for other providers", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const invalid = { type: "api", key: 42, nested: { untouched: true } }
      yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ broken: invalid })))
      yield* auth.set("valid", { type: "api", key: "sk-valid" })
      yield* auth.compareAndSet("valid", { type: "api", key: "sk-valid" }, { type: "api", key: "sk-new" })
      yield* auth.remove("missing")
      const disk = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))) as Record<string, unknown>
      expect(disk.broken).toEqual(invalid)
      expect(disk.valid).toEqual({ type: "api", key: "sk-new" })
      expect((yield* auth.all()).broken).toBeUndefined()
    }),
  )

  it.instance("refuses writes when auth.json is not valid JSON", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      yield* Effect.promise(() => fs.writeFile(file, "{not-json"))
      for (const write of [
        auth.set("valid", { type: "api", key: "sk-valid" }),
        auth.remove("valid"),
        auth.compareAndSet("valid", undefined, { type: "api", key: "sk-valid" }),
      ]) {
        const result = yield* Effect.exit(write)
        expect(result._tag).toBe("Failure")
        expect(String(result)).toContain("auth.json")
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("{not-json")
      }
    }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(path.join(Global.Path.data, "auth.json"), { force: true })))),
  )

  it.instance("compareAndSet allows only one concurrent writer for the same expected entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const expected = { type: "api" as const, key: "sk-old" }
      const winners = [
        { type: "api" as const, key: "sk-first" },
        { type: "api" as const, key: "sk-second" },
      ]
      yield* auth.set("cas-provider", expected)

      const results = yield* Effect.all(
        winners.map((next) => auth.compareAndSet("cas-provider", expected, next)),
        { concurrency: "unbounded" },
      )
      expect(results.filter((result) => result.written)).toHaveLength(1)
      const winner = winners[results.findIndex((result) => result.written)]
      expect(results.find((result) => !result.written)?.current).toEqual(winner)
      const onDisk = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))) as Record<string, unknown>
      expect(onDisk["cas-provider"]).toEqual(winner)
    }),
  )

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

  it.instance("set reads the file instead of persisting the auth env snapshot", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const previous = process.env.OPENCODE_AUTH_CONTENT
      const omitted = "omitted-provider"

      try {
        yield* Effect.promise(() =>
          fs.writeFile(file, JSON.stringify({ [omitted]: { type: "api", key: "sk-omitted" } })),
        )
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ "snapshot-provider": { type: "api", key: "sk-snapshot" } })

        yield* auth.set("written-provider", { type: "api", key: "sk-written" })

        const onDisk = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))) as Record<string, unknown>
        expect(onDisk[omitted]).toEqual({ type: "api", key: "sk-omitted" })
        expect(onDisk["written-provider"]).toEqual({ type: "api", key: "sk-written" })
      } finally {
        if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
        else process.env.OPENCODE_AUTH_CONTENT = previous
      }
    }),
  )

  it.instance("preserves both providers from concurrent writes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")

      yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ existing: { type: "api", key: "sk-existing" } })))
      yield* Effect.all(
        [
          auth.set("concurrent-a", { type: "api", key: "sk-a" }),
          auth.set("concurrent-b", { type: "api", key: "sk-b" }),
        ],
        { concurrency: "unbounded" },
      )

      const onDisk = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8"))) as Record<string, unknown>
      expect(onDisk.existing).toEqual({ type: "api", key: "sk-existing" })
      expect(onDisk["concurrent-a"]).toEqual({ type: "api", key: "sk-a" })
      expect(onDisk["concurrent-b"]).toEqual({ type: "api", key: "sk-b" })
    }),
  )

  it.instance("writes auth.json atomically with mode 0600 and no temporary file", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const before = yield* Effect.promise(() => fs.readdir(Global.Path.data))

      yield* auth.set("atomic-provider", { type: "api", key: "sk-atomic" })

      const stats = yield* Effect.promise(() => fs.stat(file))
      const after = yield* Effect.promise(() => fs.readdir(Global.Path.data))
      expect(stats.mode & 0o777).toBe(0o600)
      expect(after.filter((entry) => /^auth\.json\.\d+\..+\.tmp$/.test(entry))).toEqual(
        before.filter((entry) => /^auth\.json\.\d+\..+\.tmp$/.test(entry)),
      )
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
})
