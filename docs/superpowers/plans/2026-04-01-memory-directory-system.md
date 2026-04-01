# Memory Directory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent memory layer that stores and retrieves knowledge across sessions, with age-weighted relevance scoring.

**Architecture:** A new `Memory` namespace using the existing `Storage` JSON file system. Memories stored under `storage/memory/{projectID}/{memoryID}.json`. A `MemoryTool` provides agent access. Relevant memories auto-injected into system prompt on session start.

**Tech Stack:** TypeScript, existing `Storage` namespace, Zod schemas, `Token.estimate()`

---

### Task 1: Define the Memory data model

**Files:**

- Create: `packages/opencode/src/memory/memory.ts`
- Test: `packages/opencode/test/memory/memory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/memory/memory.test.ts
import { test, expect } from "bun:test"
import { Memory } from "../../src/memory/memory"

test("create returns a valid memory entry", () => {
  const entry = Memory.create({
    content: "The auth module uses JWT tokens with 24h expiry",
    tags: ["auth", "architecture"],
    projectID: "test-project",
    source: { sessionID: "ses_123", agent: "explore" },
  })
  expect(entry.id).toBeDefined()
  expect(entry.content).toBe("The auth module uses JWT tokens with 24h expiry")
  expect(entry.tags).toEqual(["auth", "architecture"])
  expect(entry.projectID).toBe("test-project")
  expect(entry.time.created).toBeGreaterThan(0)
  expect(entry.time.accessed).toBe(entry.time.created)
  expect(entry.accessCount).toBe(0)
})

test("scoreRelevance ranks recent + accessed memories higher", () => {
  const now = Date.now()
  const old = 1000 * 60 * 60 * 24 // 1 day ago
  const memories = [
    {
      ...Memory.create({ content: "old", tags: [], projectID: "p" }),
      time: { created: now - old * 7, accessed: now - old * 7 },
      accessCount: 0,
    },
    {
      ...Memory.create({ content: "recent", tags: [], projectID: "p" }),
      time: { created: now, accessed: now },
      accessCount: 5,
    },
    {
      ...Memory.create({ content: "mid", tags: [], projectID: "p" }),
      time: { created: now - old * 2, accessed: now - old },
      accessCount: 2,
    },
  ]
  const scored = Memory.scoreRelevance(memories, "test")
  expect(scored[0].content).toBe("recent")
  expect(scored[2].content).toBe("old")
})

test("scoreRelevance boosts tag matches", () => {
  const now = Date.now()
  const memories = [
    {
      ...Memory.create({ content: "untagged", tags: ["other"], projectID: "p" }),
      time: { created: now, accessed: now },
      accessCount: 0,
    },
    {
      ...Memory.create({ content: "tagged", tags: ["auth", "jwt"], projectID: "p" }),
      time: { created: now, accessed: now },
      accessCount: 0,
    },
  ]
  const scored = Memory.scoreRelevance(memories, "auth jwt tokens")
  expect(scored[0].content).toBe("tagged")
})

test("search finds memories by content and tags", () => {
  const memories = [
    Memory.create({ content: "Uses PostgreSQL for data storage", tags: ["database", "postgres"], projectID: "p" }),
    Memory.create({ content: "React frontend with TypeScript", tags: ["frontend", "react"], projectID: "p" }),
    Memory.create({ content: "Redis caching layer", tags: ["database", "cache"], projectID: "p" }),
  ]
  const results = Memory.search(memories, "database")
  expect(results.length).toBe(2)
  expect(results.every((m) => m.tags.includes("database"))).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/memory/memory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the Memory module**

```typescript
// src/memory/memory.ts
import { Identifier } from "../id/id"
import z from "zod"

export namespace Memory {
  export const Source = z.object({
    sessionID: z.string().optional(),
    agent: z.string().optional(),
    manual: z.boolean().optional(),
  })
  export type Source = z.infer<typeof Source>

  export const Time = z.object({
    created: z.number(),
    accessed: z.number(),
  })
  export type Time = z.infer<typeof Time>

  export const Entry = z.object({
    id: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    projectID: z.string(),
    source: Source,
    time: Time,
    accessCount: z.number(),
  })
  export type Entry = z.infer<typeof Entry>

  export function create(input: { content: string; tags: string[]; projectID: string; source?: Source }): Entry {
    const now = Date.now()
    return {
      id: Identifier.generate("mem"),
      content: input.content,
      tags: input.tags,
      projectID: input.projectID,
      source: input.source ?? {},
      time: { created: now, accessed: now },
      accessCount: 0,
    }
  }

  // Age decay: score decreases as memory ages (half-life = 7 days)
  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

  function ageScore(accessedAt: number): number {
    const age = Date.now() - accessedAt
    return Math.pow(0.5, age / HALF_LIFE_MS)
  }

  function tagMatchScore(tags: string[], query: string): number {
    const queryLower = query.toLowerCase()
    const queryWords = queryLower.split(/\s+/).filter(Boolean)
    let matches = 0
    for (const tag of tags) {
      for (const word of queryWords) {
        if (tag.toLowerCase().includes(word)) matches++
      }
    }
    return Math.min(matches / Math.max(queryWords.length, 1), 1.0)
  }

  function contentMatchScore(content: string, query: string): number {
    const contentLower = content.toLowerCase()
    const queryLower = query.toLowerCase()
    if (contentLower.includes(queryLower)) return 1.0
    const queryWords = queryLower.split(/\s+/).filter(Boolean)
    const matches = queryWords.filter((w) => contentLower.includes(w)).length
    return matches / Math.max(queryWords.length, 1)
  }

  export function scoreRelevance(memories: Entry[], query: string): Entry[] {
    return [...memories].sort((a, b) => {
      const aScore =
        ageScore(a.time.accessed) * 0.3 +
        tagMatchScore(a.tags, query) * 0.4 +
        contentMatchScore(a.content, query) * 0.2 +
        Math.min(a.accessCount / 10, 1) * 0.1
      const bScore =
        ageScore(b.time.accessed) * 0.3 +
        tagMatchScore(b.tags, query) * 0.4 +
        contentMatchScore(b.content, query) * 0.2 +
        Math.min(b.accessCount / 10, 1) * 0.1
      return bScore - aScore
    })
  }

  export function search(memories: Entry[], query: string, limit: number = 10): Entry[] {
    const scored = scoreRelevance(memories, query)
    return scored
      .filter((m) => {
        const contentMatch = contentMatchScore(m.content, query)
        const tagMatch = tagMatchScore(m.tags, query)
        return contentMatch > 0 || tagMatch > 0
      })
      .slice(0, limit)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/memory/memory.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/memory/memory.ts packages/opencode/test/memory/memory.test.ts
git commit -m "feat: add Memory data model with relevance scoring"
```

---

### Task 2: Add Storage persistence layer

**Files:**

- Create: `packages/opencode/src/memory/store.ts`
- Test: `packages/opencode/test/memory/store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/memory/store.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test"
import { MemoryStore } from "../../src/memory/store"
import { Memory } from "../../src/memory/memory"
import { Storage } from "../../src/storage/storage"

test("save and retrieve a memory", async () => {
  const entry = Memory.create({ content: "Test memory", tags: ["test"], projectID: "proj-1" })
  await MemoryStore.save(entry)
  const retrieved = await MemoryStore.get(entry.id, "proj-1")
  expect(retrieved).toBeDefined()
  expect(retrieved!.content).toBe("Test memory")
})

test("list memories by project", async () => {
  const m1 = Memory.create({ content: "Mem 1", tags: [], projectID: "proj-list" })
  const m2 = Memory.create({ content: "Mem 2", tags: [], projectID: "proj-list" })
  await MemoryStore.save(m1)
  await MemoryStore.save(m2)
  const list = await MemoryStore.list("proj-list")
  expect(list.length).toBeGreaterThanOrEqual(2)
})

test("search memories across project", async () => {
  const m = Memory.create({ content: "Uses Redis for caching", tags: ["cache", "redis"], projectID: "proj-search" })
  await MemoryStore.save(m)
  const results = await MemoryStore.search("redis", "proj-search")
  expect(results.length).toBeGreaterThanOrEqual(1)
  expect(results[0].content).toContain("Redis")
})

test("delete a memory", async () => {
  const entry = Memory.create({ content: "To delete", tags: [], projectID: "proj-del" })
  await MemoryStore.save(entry)
  await MemoryStore.remove(entry.id, "proj-del")
  const retrieved = await MemoryStore.get(entry.id, "proj-del")
  expect(retrieved).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/memory/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MemoryStore**

```typescript
// src/memory/store.ts
import { Storage } from "../storage/storage"
import { Memory } from "./memory"

export namespace MemoryStore {
  export async function save(entry: Memory.Entry): Promise<void> {
    await Storage.write(["memory", entry.projectID, entry.id], entry)
  }

  export async function get(id: string, projectID: string): Promise<Memory.Entry | null> {
    return Storage.read<Memory.Entry>(["memory", projectID, id])
  }

  export async function list(projectID: string): Promise<Memory.Entry[]> {
    const keys = await Storage.list(["memory", projectID])
    const entries = await Promise.all(keys.map((k) => Storage.read<Memory.Entry>(k)))
    return entries.filter((e): e is Memory.Entry => e !== null)
  }

  export async function search(query: string, projectID: string, limit: number = 10): Promise<Memory.Entry[]> {
    const all = await list(projectID)
    return Memory.search(all, query, limit)
  }

  export async function remove(id: string, projectID: string): Promise<void> {
    await Storage.remove(["memory", projectID, id])
  }

  export async function touch(id: string, projectID: string): Promise<void> {
    const entry = await get(id, projectID)
    if (!entry) return
    entry.time.accessed = Date.now()
    entry.accessCount++
    await save(entry)
  }

  /** Get recent memories formatted for system prompt injection */
  export async function getRecentForPrompt(projectID: string, limit: number = 5): Promise<string[]> {
    const all = await list(projectID)
    const sorted = [...all].sort((a, b) => b.time.accessed - a.time.accessed)
    return sorted.slice(0, limit).map((m) => m.content)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/memory/store.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/memory/store.ts packages/opencode/test/memory/store.test.ts
git commit -m "feat: add MemoryStore persistence layer"
```

---

### Task 3: Add the Memory tool for agents

**Files:**

- Create: `packages/opencode/src/tool/memory.ts`

- [ ] **Step 1: Implement the Memory tool**

Follow the pattern from `packages/opencode/src/tool/bash.ts` — use `Tool.define()` with Zod schema for input validation. The tool should support actions: `save`, `search`, `list`, `delete`.

```typescript
// src/tool/memory.ts
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { MemoryStore } from "../memory/store"
import { Memory } from "../memory/memory"
import z from "zod"

export const MemoryTool = Tool.define({
  name: "memory",
  description:
    "Store and retrieve persistent memories across sessions. Use this to remember important decisions, architecture patterns, or learnings.",
  parameters: z.object({
    action: z.enum(["save", "search", "list", "delete"]).describe("Action to perform"),
    content: z.string().optional().describe("Content to save (for save action)"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    query: z.string().optional().describe("Search query (for search action)"),
    id: z.string().optional().describe("Memory ID (for delete action)"),
  }),
  async execute(input, ctx) {
    const projectID = Instance.project.id

    switch (input.action) {
      case "save": {
        if (!input.content) return "Error: content is required for save action"
        const entry = Memory.create({
          content: input.content,
          tags: input.tags ?? [],
          projectID,
          source: { sessionID: ctx.sessionID },
        })
        await MemoryStore.save(entry)
        return `Memory saved (id: ${entry.id}, tags: [${entry.tags.join(", ")}])`
      }
      case "search": {
        if (!input.query) return "Error: query is required for search action"
        const results = await MemoryStore.search(input.query, projectID)
        if (results.length === 0) return "No memories found."
        return results.map((m) => `[${m.tags.join(", ")}] ${m.content} (accessed ${m.accessCount}x)`).join("\n")
      }
      case "list": {
        const all = await MemoryStore.list(projectID)
        if (all.length === 0) return "No memories stored."
        const sorted = [...all].sort((a, b) => b.time.accessed - a.time.accessed).slice(0, 20)
        return sorted.map((m) => `[${m.tags.join(", ")}] ${m.content}`).join("\n")
      }
      case "delete": {
        if (!input.id) return "Error: id is required for delete action"
        await MemoryStore.remove(input.id, projectID)
        return `Memory ${input.id} deleted.`
      }
    }
  },
})
```

- [ ] **Step 2: Register the tool**

Add `MemoryTool` to the tool registry. Look at how tools are registered in `packages/opencode/src/tool/registry.ts` and add the memory tool to the list.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/tool/memory.ts
git commit -m "feat: add Memory tool for agent-accessible persistent memories"
```

---

### Task 4: Auto-inject memories into system prompt

**Files:**

- Modify: `packages/opencode/src/session/system.ts`

- [ ] **Step 1: Add memory injection to SystemPrompt.custom()**

At the end of the `custom()` function in `packages/opencode/src/session/system.ts`, after the existing rule file loading, add:

```typescript
// After existing custom() logic, before the return:
const { MemoryStore } = await import("../memory/store")
const memories = await MemoryStore.getRecentForPrompt(Instance.project.id, 5)
if (memories.length > 0) {
  result.push("## Remembered Context\n" + memories.map((m, i) => `${i + 1}. ${m}`).join("\n"))
}
```

This injects the 5 most recently accessed memories into every new session's system prompt.

- [ ] **Step 2: Add config option**

In `packages/opencode/src/config/config.ts`, add a `memory.enabled` boolean (default: true) to the config schema. Gate the injection behind this config.

- [ ] **Step 3: Test end-to-end**

1. Start opencode, save a memory: "This project uses Bun runtime"
2. Start a new session
3. Verify the memory appears in the system prompt context
4. Search the memory: verify it's found

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: auto-inject memories into system prompt on session start"
```

---

### Task 5: Add `/memory` slash command

**Files:**

- Create: `packages/opencode/src/cli/cmd/memory.ts`

- [ ] **Step 1: Create the CLI command**

Follow the pattern from `packages/opencode/src/cli/cmd/session.ts`. Support subcommands: `list`, `search <query>`, `add <content> --tags tag1,tag2`.

- [ ] **Step 2: Register the command**

Add to the CLI command registry alongside existing commands.

- [ ] **Step 3: Test manually**

Run: `bun run --conditions=browser ./src/index.ts memory list`
Expected: List of memories or "No memories stored."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add /memory CLI command"
```

---

### Task 6: Run typecheck and full tests

- [ ] **Step 1: Run typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `cd packages/opencode && bun test`
Expected: All tests pass, no regressions
