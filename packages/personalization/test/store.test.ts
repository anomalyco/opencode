import { describe, expect, it } from "bun:test"
import { saveUserProfile, loadUserProfile, saveMemory, loadMemories } from "../src/store"
import { DEFAULT_USER_PROFILE } from "../src/profile"
import type { MemoryRecord } from "../src/memory"

describe("Store Persistence Flow", () => {
  // In-memory mock database adhering to DatabaseSession query builder pattern
  function createMockDb() {
    const profiles = new Map<string, any>()
    const memories = new Map<string, any>()
    const events: any[] = []

    return {
      select: () => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            get: async () => {
              for (const p of profiles.values()) return p
              return undefined
            },
            all: async () => Array.from(memories.values()),
            orderBy: () => ({
              all: async () => Array.from(memories.values()),
            }),
          }),
          orderBy: () => ({
            all: async () => Array.from(memories.values()),
          }),
        }),
      }),
      insert: (table: any) => ({
        values: (val: any) => ({
          run: async () => {
            if (val.user_id && val.profile_json) {
              profiles.set(val.user_id, val)
            } else if (val.id && val.content) {
              memories.set(val.id, val)
            } else {
              events.push(val)
            }
          },
        }),
      }),
      update: (table: any) => ({
        set: (val: any) => ({
          where: (cond: any) => ({
            run: async () => {
              for (const [k, p] of profiles.entries()) {
                profiles.set(k, { ...p, ...val })
              }
            },
          }),
        }),
      }),
      _state: { profiles, memories, events },
    }
  }

  it("should persist and load user profile", async () => {
    const mockDb = createMockDb()
    const customProfile = {
      ...DEFAULT_USER_PROFILE,
      languages: ["rust", "typescript"],
      style: {
        ...DEFAULT_USER_PROFILE.style,
        explicitness: 0.99,
      },
    }

    await saveUserProfile(mockDb, "dev_42", customProfile)
    const loaded = await loadUserProfile(mockDb, "dev_42")

    expect(loaded.languages).toContain("rust")
    expect(loaded.style.explicitness).toBe(0.99)
  })

  it("should persist and load memories by user", async () => {
    const mockDb = createMockDb()
    const record: MemoryRecord = {
      id: "mem_100",
      userId: "dev_42",
      tier: "preference",
      category: "style",
      content: "Avoid inheritance hierarchies",
      confidence: 0.95,
      accessCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await saveMemory(mockDb, record)
    const memories = await loadMemories(mockDb, "dev_42")

    expect(memories.length).toBe(1)
    expect(memories[0]?.content).toBe("Avoid inheritance hierarchies")
  })
})
