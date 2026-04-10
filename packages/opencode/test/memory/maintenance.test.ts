import { afterEach, describe, test, expect } from "bun:test"
import { eq } from "drizzle-orm"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { MemoryTable } from "../../src/memory/memory.sql"
import { MemoryMaintenance } from "../../src/memory/maintenance"
import { MemoryPromoter } from "../../src/memory/promoter"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

type DbClient = Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never

function seed(d: DbClient, input: {
  id: string
  projectPath: string
  topic: string
  type: string
  content: string
  accessCount?: number
  scope?: string
  relevanceScore?: number
  timeUpdated?: number
}) {
  const now = Date.now()
  d.insert(MemoryTable).values({
    id: input.id,
    project_path: input.projectPath,
    topic: input.topic,
    type: input.type,
    content: input.content,
    session_id: null,
    access_count: input.accessCount ?? 0,
    scope: input.scope ?? "project",
    relevance_score: input.relevanceScore ?? 1.0,
    time_last_verified: null,
    promoted_from: null,
    time_created: now,
    time_updated: input.timeUpdated ?? now,
  }).run()
}

describe("MemoryMaintenance.mergeDuplicates", () => {
  test("merges entries with same lowercase name", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        Database.use((d) => {
          seed(d, { id: "dup1", projectPath, topic: "Hello World", type: "project", content: "content A", accessCount: 1 })
          seed(d, { id: "dup2", projectPath, topic: "hello world", type: "project", content: "content B", accessCount: 2 })
        })

        const merged = await MemoryMaintenance.mergeDuplicates(projectPath)
        expect(merged).toBe(1)

        const remaining = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.project_path, projectPath)).all()
        )
        expect(remaining.length).toBe(1)
      },
    })
  })

  test("keeps entry with highest access count", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        Database.use((d) => {
          seed(d, { id: "low", projectPath, topic: "Topic", type: "project", content: "low", accessCount: 1 })
          seed(d, { id: "mid", projectPath, topic: "topic", type: "project", content: "mid", accessCount: 5 })
          seed(d, { id: "high", projectPath, topic: "TOPIC", type: "project", content: "high", accessCount: 10 })
        })

        await MemoryMaintenance.mergeDuplicates(projectPath)

        const remaining = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.project_path, projectPath)).all()
        )
        expect(remaining.length).toBe(1)
        expect(remaining[0].id).toBe("high")
        expect(remaining[0].access_count).toBe(10)
      },
    })
  })

  test("concatenates content from duplicates", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        Database.use((d) => {
          seed(d, { id: "a", projectPath, topic: "merge me", type: "project", content: "alpha", accessCount: 5 })
          seed(d, { id: "b", projectPath, topic: "Merge Me", type: "project", content: "beta", accessCount: 3 })
        })

        await MemoryMaintenance.mergeDuplicates(projectPath)

        const remaining = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.project_path, projectPath)).all()
        )
        expect(remaining.length).toBe(1)
        expect(remaining[0].content).toContain("alpha")
        expect(remaining[0].content).toContain("beta")
      },
    })
  })

  test("returns 0 when no duplicates exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        Database.use((d) => {
          seed(d, { id: "unique1", projectPath, topic: "first topic", type: "project", content: "c1" })
          seed(d, { id: "unique2", projectPath, topic: "second topic", type: "project", content: "c2" })
        })

        const merged = await MemoryMaintenance.mergeDuplicates(projectPath)
        expect(merged).toBe(0)
      },
    })
  })
})

describe("MemoryMaintenance.decayRelevance", () => {
  test("decays entries older than 7 days", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

        Database.use((d) => {
          seed(d, {
            id: "old1",
            projectPath,
            topic: "old entry",
            type: "project",
            content: "stale",
            relevanceScore: 1.0,
            timeUpdated: fourteenDaysAgo,
          })
        })

        const decayed = await MemoryMaintenance.decayRelevance(projectPath)
        expect(decayed).toBe(1)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "old1")).get()
        )
        // 14 days = 2 periods of 7 days => 0.95^2 = 0.9025
        expect(row!.relevance_score).toBeCloseTo(0.9025, 3)
      },
    })
  })

  test("skips entries updated within 7 days", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, {
            id: "recent1",
            projectPath,
            topic: "recent entry",
            type: "project",
            content: "fresh",
            relevanceScore: 1.0,
          })
        })

        const decayed = await MemoryMaintenance.decayRelevance(projectPath)
        expect(decayed).toBe(0)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "recent1")).get()
        )
        expect(row!.relevance_score).toBe(1.0)
      },
    })
  })

  test("skips insignificant changes below 0.001 threshold", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        // 1 period (7-13 days): 0.95^1 = 0.95, diff from 0.95 = 0.0
        // Already at 0.95 score with 1 period => new = 0.95 * 0.95 = 0.9025, diff = 0.0475 > 0.001
        // For insignificance: score must be tiny so diff < 0.001
        // score=0.01, 1 period: new=0.0095, diff=0.0005 < 0.001 => skipped
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000

        Database.use((d) => {
          seed(d, {
            id: "tiny1",
            projectPath,
            topic: "tiny entry",
            type: "project",
            content: "minimal",
            relevanceScore: 0.01,
            timeUpdated: eightDaysAgo,
          })
        })

        const decayed = await MemoryMaintenance.decayRelevance(projectPath)
        expect(decayed).toBe(0)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "tiny1")).get()
        )
        expect(row!.relevance_score).toBe(0.01)
      },
    })
  })
})

describe("MemoryMaintenance.removeStale", () => {
  test("removes entries with relevanceScore < 0.1", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, {
            id: "stale1",
            projectPath,
            topic: "stale entry",
            type: "project",
            content: "should be removed",
            relevanceScore: 0.05,
          })
        })

        await MemoryMaintenance.removeStale(projectPath)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "stale1")).get()
        )
        expect(row).toBeUndefined()
      },
    })
  })

  test("keeps entries with relevanceScore >= 0.1", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, {
            id: "healthy1",
            projectPath,
            topic: "healthy entry",
            type: "project",
            content: "should remain",
            relevanceScore: 0.5,
          })
        })

        await MemoryMaintenance.removeStale(projectPath)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "healthy1")).get()
        )
        expect(row).toBeDefined()
        expect(row!.relevance_score).toBe(0.5)
      },
    })
  })

  test("returns count of removed entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, { id: "rm1", projectPath, topic: "rm one", type: "project", content: "c1", relevanceScore: 0.02 })
          seed(d, { id: "rm2", projectPath, topic: "rm two", type: "project", content: "c2", relevanceScore: 0.09 })
          seed(d, { id: "keep1", projectPath, topic: "keep", type: "project", content: "c3", relevanceScore: 0.8 })
        })

        const removed = await MemoryMaintenance.removeStale(projectPath)
        expect(removed).toBe(2)

        const remaining = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.project_path, projectPath)).all()
        )
        expect(remaining.length).toBe(1)
        expect(remaining[0].id).toBe("keep1")
      },
    })
  })
})

describe("MemoryMaintenance.verifyReferences", () => {
  test("penalizes entries referencing missing files", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, {
            id: "ref1",
            projectPath,
            topic: "broken ref",
            type: "project",
            content: "see ./nonexistent.ts for details",
            relevanceScore: 1.0,
          })
        })

        const verified = await MemoryMaintenance.verifyReferences(projectPath)
        expect(verified).toBe(1)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "ref1")).get()
        )
        expect(row!.relevance_score).toBeLessThan(1.0)
      },
    })
  })

  test("does not penalize when all referenced files exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path
        const realFile = path.join(projectPath, "existing.ts")
        await Bun.write(realFile, "export const x = 1")

        Database.use((d) => {
          seed(d, {
            id: "ref2",
            projectPath,
            topic: "valid ref",
            type: "project",
            content: "see ./existing.ts for details",
            relevanceScore: 1.0,
          })
        })

        await MemoryMaintenance.verifyReferences(projectPath)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "ref2")).get()
        )
        expect(row!.relevance_score).toBe(1.0)
      },
    })
  })

  test("skips paths outside project directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, {
            id: "ref3",
            projectPath,
            topic: "escape ref",
            type: "project",
            content: "see ../../etc/passwd for secrets",
            relevanceScore: 1.0,
          })
        })

        const verified = await MemoryMaintenance.verifyReferences(projectPath)
        // Path outside project is skipped, so 0 missing files counted
        expect(verified).toBe(0)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "ref3")).get()
        )
        expect(row!.relevance_score).toBe(1.0)
      },
    })
  })
})

describe("MemoryMaintenance.run", () => {
  test("executes full cycle without error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, { id: "run1", projectPath, topic: "normal", type: "project", content: "active entry", relevanceScore: 0.8 })
          seed(d, { id: "run2", projectPath, topic: "stale", type: "project", content: "dying entry", relevanceScore: 0.05 })
        })

        // Should not throw
        await MemoryMaintenance.run(projectPath)

        // Stale entry should have been removed
        const stale = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "run2")).get()
        )
        expect(stale).toBeUndefined()

        // Normal entry should still exist
        const normal = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "run1")).get()
        )
        expect(normal).toBeDefined()
      },
    })
  })
})

describe("MemoryPromoter.detectCandidates", () => {
  test("returns entries with accessCount > 5 and scope personal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, { id: "cand1", projectPath, topic: "hot entry", type: "project", content: "popular", scope: "personal", accessCount: 10 })
          seed(d, { id: "cand2", projectPath, topic: "warm entry", type: "project", content: "somewhat", scope: "personal", accessCount: 6 })
        })

        const candidates = await MemoryPromoter.detectCandidates(projectPath)
        expect(candidates.length).toBe(2)
        const ids = candidates.map((c) => c.id).sort()
        expect(ids).toEqual(["cand1", "cand2"])
      },
    })
  })

  test("excludes entries with accessCount <= 5", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, { id: "low1", projectPath, topic: "cold entry", type: "project", content: "rarely used", scope: "personal", accessCount: 3 })
          seed(d, { id: "edge1", projectPath, topic: "edge entry", type: "project", content: "at threshold", scope: "personal", accessCount: 5 })
        })

        const candidates = await MemoryPromoter.detectCandidates(projectPath)
        expect(candidates.length).toBe(0)
      },
    })
  })
})

describe("MemoryPromoter.autoPromote", () => {
  test("promotes eligible entries to project scope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, { id: "promo1", projectPath, topic: "promote me", type: "project", content: "popular item", scope: "personal", accessCount: 8 })
        })

        await MemoryPromoter.autoPromote(projectPath)

        const row = Database.use((d) =>
          d.select().from(MemoryTable).where(eq(MemoryTable.id, "promo1")).get()
        )
        expect(row!.scope).toBe("project")
        expect(row!.promoted_from).toBe("personal")
      },
    })
  })

  test("returns count of promoted entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectPath = tmp.path

        Database.use((d) => {
          seed(d, { id: "p1", projectPath, topic: "entry one", type: "project", content: "c1", scope: "personal", accessCount: 7 })
          seed(d, { id: "p2", projectPath, topic: "entry two", type: "project", content: "c2", scope: "personal", accessCount: 9 })
          seed(d, { id: "p3", projectPath, topic: "entry three", type: "project", content: "c3", scope: "personal", accessCount: 2 })
        })

        const promoted = await MemoryPromoter.autoPromote(projectPath)
        expect(promoted).toBe(2)

        // Verify the two promoted entries changed scope
        const e1 = Database.use((d) => d.select().from(MemoryTable).where(eq(MemoryTable.id, "p1")).get())
        const e2 = Database.use((d) => d.select().from(MemoryTable).where(eq(MemoryTable.id, "p2")).get())
        const e3 = Database.use((d) => d.select().from(MemoryTable).where(eq(MemoryTable.id, "p3")).get())
        expect(e1!.scope).toBe("project")
        expect(e2!.scope).toBe("project")
        expect(e3!.scope).toBe("personal")
      },
    })
  })
})
