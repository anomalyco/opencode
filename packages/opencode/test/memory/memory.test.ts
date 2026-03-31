import { describe, it, expect, beforeEach } from "bun:test"
import { Effect, Option, Layer } from "effect"
import { Database } from "../../src/storage/db"
import { MemoryRepo } from "../../src/memory/repo"
import { MemoryID, RuleID, APIKeyID } from "../../src/memory/schema"

describe("Memory", () => {
  beforeEach(() => {
    Database.close()
  })

  it("should set and get a preference", async () => {
    const testLayer = MemoryRepo.layer
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* MemoryRepo
        const id = MemoryID.make("pref-1")
        yield* repo.setPreference({
          id,
          key: "test-key",
          value: "test-value",
          type: "string",
          description: "Test preference",
        })
        return yield* repo.getPreference("test-key")
      }).pipe(Effect.provide(testLayer)),
    )

    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      const value = result.value as { key: string; value: string; type: string }
      expect(value.key).toBe("test-key")
      expect(value.value).toBe("test-value")
      expect(value.type).toBe("string")
    }
  })

  it("should set and get rules for a project", async () => {
    const testLayer = MemoryRepo.layer
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* MemoryRepo
        const id = RuleID.make("rule-1")
        yield* repo.setRule({
          id,
          projectID: "test-project",
          pattern: "*.ts",
          rule: "Use strict TypeScript",
          priority: 1,
          enabled: true,
        })
        return yield* repo.getRulesForProject("test-project")
      }).pipe(Effect.provide(testLayer)),
    )

    expect(Array.isArray(result)).toBe(true)
  })

  it("should set and get API keys", async () => {
    const testLayer = MemoryRepo.layer
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* MemoryRepo
        const id = APIKeyID.make("key-1")
        yield* repo.setAPIKey({
          id,
          provider: "openai",
          keyName: "api-key-1",
          encryptedValue: "encrypted-secret",
          description: "Test API key",
        })
        return yield* repo.getAPIKeys()
      }).pipe(Effect.provide(testLayer)),
    )

    expect(Array.isArray(result)).toBe(true)
  })
})
