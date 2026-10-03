import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
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
})

describe("Auth Profiles", () => {
  it.instance("set and get with profile", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", { type: "api", key: "sk-default" })
      yield* auth.set("openrouter", { type: "api", key: "sk-work" }, "work")
      yield* auth.set("openrouter", { type: "api", key: "sk-personal" }, "personal")

      const def = yield* auth.get("openrouter")
      expect(def?.type).toBe("api")
      if (def?.type === "api") expect(def.key).toBe("sk-default")

      const work = yield* auth.get("openrouter", "work")
      expect(work?.type).toBe("api")
      if (work?.type === "api") expect(work.key).toBe("sk-work")

      const personal = yield* auth.get("openrouter", "personal")
      expect(personal?.type).toBe("api")
      if (personal?.type === "api") expect(personal.key).toBe("sk-personal")
    }),
  )

  it.instance("profiles lists all profiles for a provider", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", { type: "api", key: "sk-default" })
      yield* auth.set("openrouter", { type: "api", key: "sk-work" }, "work")

      const profiles = yield* auth.profiles("openrouter")
      expect(profiles.length).toBe(2)
      const names = profiles.map((p) => p.profile).sort()
      expect(names).toEqual([undefined, "work"])
    }),
  )

  it.instance("hasDefault returns true when default exists", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", { type: "api", key: "sk-default" })

      expect(yield* auth.hasDefault("openrouter")).toBe(true)
      expect(yield* auth.hasDefault("anthropic")).toBe(false)
    }),
  )

  it.instance("setDefault swaps named profile to default", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", { type: "api", key: "sk-old-default" })
      yield* auth.set("openrouter", { type: "api", key: "sk-work" }, "work")

      yield* auth.setDefault("openrouter", "work")

      const def = yield* auth.get("openrouter")
      expect(def?.type).toBe("api")
      if (def?.type === "api") expect(def.key).toBe("sk-work")

      const old = yield* auth.get("openrouter", "work")
      expect(old?.type).toBe("api")
      if (old?.type === "api") expect(old.key).toBe("sk-old-default")
    }),
  )

  it.instance("remove with profile only removes that profile", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", { type: "api", key: "sk-default" })
      yield* auth.set("openrouter", { type: "api", key: "sk-work" }, "work")

      yield* auth.remove("openrouter", "work")

      const def = yield* auth.get("openrouter")
      expect(def?.type).toBe("api")

      const work = yield* auth.get("openrouter", "work")
      expect(work).toBeUndefined()
    }),
  )
})

describe("Auth parseKey / buildKey", () => {
  it("parseKey returns providerID only for simple keys", () => {
    expect(Auth.parseKey("openrouter")).toEqual({ providerID: "openrouter" })
    expect(Auth.parseKey("anthropic")).toEqual({ providerID: "anthropic" })
  })

  it("parseKey splits providerID and profile", () => {
    expect(Auth.parseKey("openrouter:work")).toEqual({ providerID: "openrouter", profile: "work" })
    expect(Auth.parseKey("anthropic:personal")).toEqual({ providerID: "anthropic", profile: "personal" })
  })

  it("buildKey creates simple key when no profile", () => {
    expect(Auth.buildKey("openrouter")).toBe("openrouter")
    expect(Auth.buildKey("openrouter", undefined)).toBe("openrouter")
  })

  it("buildKey creates composite key with profile", () => {
    expect(Auth.buildKey("openrouter", "work")).toBe("openrouter:work")
  })

  it("validateProfileName accepts valid names", () => {
    expect(Auth.validateProfileName("work")).toBe(true)
    expect(Auth.validateProfileName("my-profile")).toBe(true)
    expect(Auth.validateProfileName("profile_1")).toBe(true)
  })

  it("validateProfileName rejects invalid names", () => {
    expect(Auth.validateProfileName("")).toBe(false)
    expect(Auth.validateProfileName("my profile")).toBe(false)
    expect(Auth.validateProfileName("my@profile")).toBe(false)
  })
})
