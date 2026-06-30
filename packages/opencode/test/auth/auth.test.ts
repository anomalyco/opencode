import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { Auth, AuthError } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

// Tracks and restores the previous value of OPENCODE_AUTH_CONTENT so a test
// (or sibling tests) cannot leak state across runs.
function withAuthContent<A, E, R>(self: Effect.Effect<A, E, R>, value: string | undefined): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_AUTH_CONTENT
      if (value === undefined) delete process.env.OPENCODE_AUTH_CONTENT
      else process.env.OPENCODE_AUTH_CONTENT = value
      return previous
    }),
    () => self,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
        else process.env.OPENCODE_AUTH_CONTENT = previous
      }),
  )
}

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

  // Regression: #34075 — env-var path previously bypassed schema validation
  // and silently swallowed JSON parse errors, so malformed OPENCODE_AUTH_CONTENT
  // fell through to file-based auth and invalid entries reached downstream
  // code that switches on info.type. The fix applies the same
  // Record.filterMap(decode) validation that the file path already uses, and
  // surfaces parse errors as AuthError.
  it.instance("all() returns valid entries from OPENCODE_AUTH_CONTENT (env-var path)", () =>
    withAuthContent(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const env = JSON.stringify({
          anthropic: { type: "api", key: "sk-test-anthropic" },
          openai: { type: "wellknown", key: "K", token: "T" },
        })
        const data = yield* withAuthContent(auth.all(), env)
        expect(data["anthropic"]).toEqual({ type: "api", key: "sk-test-anthropic" })
        expect(data["openai"]).toEqual({ type: "wellknown", key: "K", token: "T" })
      }),
      undefined,
    ),
  )

  it.instance("all() filters out entries whose type is not a valid Auth.Info schema", () =>
    withAuthContent(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const env = JSON.stringify({
          good: { type: "api", key: "valid" },
          bad: { type: "unknown_type", key: "x" },
          missingType: { key: "no-type" },
          notAnObject: "string-value",
          numberValue: 42,
          nullValue: null,
        })
        const data = yield* withAuthContent(auth.all(), env)
        expect(data["good"]).toEqual({ type: "api", key: "valid" })
        expect(data["bad"]).toBeUndefined()
        expect(data["missingType"]).toBeUndefined()
        expect(data["notAnObject"]).toBeUndefined()
        expect(data["numberValue"]).toBeUndefined()
        expect(data["nullValue"]).toBeUndefined()
      }),
      undefined,
    ),
  )

  it.instance("all() surfaces malformed JSON in OPENCODE_AUTH_CONTENT as AuthError", () =>
    withAuthContent(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const exit = yield* withAuthContent(auth.all(), "{not valid json").pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause)
          expect(squashed).toBeInstanceOf(AuthError)
          expect((squashed as AuthError).message).toMatch(/OPENCODE_AUTH_CONTENT/)
        }
      }),
      undefined,
    ),
  )

  it.instance("all() surfaces non-object top-level JSON in OPENCODE_AUTH_CONTENT as AuthError", () =>
    withAuthContent(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        // top-level array is valid JSON but cannot be Record<string, Info>
        const exit = yield* withAuthContent(auth.all(), "[1,2,3]").pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause)
          expect(squashed).toBeInstanceOf(AuthError)
        }
      }),
      undefined,
    ),
  )

  it.instance("all() preserves file-path behavior when OPENCODE_AUTH_CONTENT is empty", () =>
    withAuthContent(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("file-only", { type: "api", key: "sk-from-file" })
        const data = yield* withAuthContent(auth.all(), "")
        // empty string is falsy → falls through to file path
        expect(data["file-only"]).toEqual({ type: "api", key: "sk-from-file" })
      }),
      undefined,
    ),
  )

  it.instance("all() preserves file-path behavior when OPENCODE_AUTH_CONTENT is unset", () =>
    withAuthContent(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("file-only", { type: "api", key: "sk-from-file" })
        const data = yield* withAuthContent(auth.all(), undefined)
        expect(data["file-only"]).toEqual({ type: "api", key: "sk-from-file" })
      }),
      undefined,
    ),
  )
})
