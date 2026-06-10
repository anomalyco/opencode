import { describe, expect, it as bun_it } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

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
})

const decodeInfo = Schema.decodeUnknownOption(Auth.Info)
const decodeInfoSync = Schema.decodeUnknownSync(Auth.Info)

describe("SnowflakeSession schema", () => {
  const validSession = {
    type: "snowflake-session",
    account: "myorg-myaccount",
    session_token: "sess-abc",
    master_token: "mast-xyz",
    session_expires: 1_700_000_000_000,
    master_expires: 1_700_014_400_000,
  }

  bun_it("decodes a valid snowflake-session object with all 5 fields", () => {
    const result = decodeInfo(validSession)
    expect(Option.isSome(result)).toBe(true)
    const value = Option.getOrThrow(result)
    expect(value).toBeInstanceOf(Auth.SnowflakeSession)
    expect(value.type).toBe("snowflake-session")
    if (value instanceof Auth.SnowflakeSession) {
      expect(value.account).toBe("myorg-myaccount")
      expect(value.session_token).toBe("sess-abc")
      expect(value.master_token).toBe("mast-xyz")
      expect(value.session_expires).toBe(1_700_000_000_000)
      expect(value.master_expires).toBe(1_700_014_400_000)
    }
  })

  bun_it("encode/decode round-trips to deep-equal original", () => {
    const decoded = decodeInfoSync(validSession)
    // encode back via Schema.encodeSync and re-decode; result should equal original
    const encodeSync = Schema.encodeSync(Auth.Info)
    const reencoded = encodeSync(decoded as Auth.SnowflakeSession)
    const redecoded = decodeInfoSync(reencoded)
    expect(redecoded).toEqual(decoded)
  })

  bun_it("returns None when master_token is missing", () => {
    const { master_token: _, ...noMaster } = validSession
    const result = decodeInfo(noMaster)
    expect(Option.isNone(result)).toBe(true)
  })

  bun_it("existing Oauth type still decodes after union change (regression)", () => {
    const oauth = {
      type: "oauth",
      refresh: "r",
      access: "a",
      expires: 0,
    }
    const result = decodeInfo(oauth)
    expect(Option.isSome(result)).toBe(true)
    expect(Option.getOrThrow(result)).toBeInstanceOf(Auth.Oauth)
  })

  bun_it("existing Api type still decodes after union change (regression)", () => {
    const api = { type: "api", key: "sk-test" }
    const result = decodeInfo(api)
    expect(Option.isSome(result)).toBe(true)
    expect(Option.getOrThrow(result)).toBeInstanceOf(Auth.Api)
  })

  bun_it("existing WellKnown type still decodes after union change (regression)", () => {
    const wk = { type: "wellknown", key: "k", token: "t" }
    const result = decodeInfo(wk)
    expect(Option.isSome(result)).toBe(true)
    expect(Option.getOrThrow(result)).toBeInstanceOf(Auth.WellKnown)
  })

  // Verifies that the TUI sentinel path (ProviderAuth.callback converting metadata strings to numbers)
  // produces a SnowflakeSession that is shape-identical to what the CLI writes directly.
  bun_it("TUI sentinel conversion produces same SnowflakeSession shape as CLI direct write", () => {
    const sessionExpires = 1700000000000
    const masterExpires = 1700014400000

    // Simulate what ProviderAuth.callback does when it sees the sentinel:
    // metadata values are strings, converted to numbers via Number()
    const fromTuiPath = decodeInfoSync({
      type: "snowflake-session",
      account: "myorg-myaccount",
      session_token: "session-tok",
      master_token: "master-tok",
      session_expires: Number("1700000000000"),
      master_expires: Number("1700014400000"),
    })

    // CLI path writes numbers directly
    const fromCliPath = decodeInfoSync({
      type: "snowflake-session",
      account: "myorg-myaccount",
      session_token: "session-tok",
      master_token: "master-tok",
      session_expires: sessionExpires,
      master_expires: masterExpires,
    })

    expect(fromTuiPath).toEqual(fromCliPath)
    expect(fromTuiPath).toBeInstanceOf(Auth.SnowflakeSession)
    if (fromTuiPath instanceof Auth.SnowflakeSession) {
      expect(typeof fromTuiPath.session_expires).toBe("number")
      expect(typeof fromTuiPath.master_expires).toBe("number")
      expect(fromTuiPath.session_expires).toBe(sessionExpires)
      expect(fromTuiPath.master_expires).toBe(masterExpires)
    }
  })
})
