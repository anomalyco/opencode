import z from "zod"
import path from "path"
import { ulid } from "ulid"
import { Global } from "../global"
import { Database, eq } from "../storage/db"
import { MemoryTable } from "./memory.sql"
import { Log } from "../util/log"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { InstanceState } from "@/effect/instance-state"
import fs from "fs/promises"

export namespace Memory {
  const log = Log.create({ service: "memory" })

  export const Type = z.enum(["user", "feedback", "project", "reference"])
  export type Type = z.infer<typeof Type>

  export const Info = z.object({
    id: z.string(),
    scope: z.enum(["user", "project"]),
    project_id: z.string().optional(),
    type: Type,
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    file: z.string(),
    time_created: z.number(),
    time_updated: z.number(),
  })
  export type Info = z.infer<typeof Info>

  export const AddInput = z.object({
    type: Type,
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    scope: z.enum(["user", "project"]).optional().default("user"),
  })
  export type AddInput = z.infer<typeof AddInput>

  function userMemDir() {
    return path.join(Global.Path.data, "memory")
  }

  function toInfo(row: typeof MemoryTable.$inferSelect): Info {
    return {
      id: row.id,
      scope: row.scope as "user" | "project",
      project_id: row.project_id ?? undefined,
      type: row.type as Type,
      title: row.title,
      content: row.content,
      tags: (row.tags as string[] | null) ?? undefined,
      file: row.file,
      time_created: row.time_created,
      time_updated: row.time_updated,
    }
  }

  function slugify(title: string) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
  }

  export interface Interface {
    readonly list: (scope?: "user" | "project") => Effect.Effect<Info[]>
    readonly get: (id: string) => Effect.Effect<Info | undefined>
    readonly add: (input: AddInput) => Effect.Effect<Info>
    readonly remove: (id: string) => Effect.Effect<void>
    readonly recall: (query: string) => Effect.Effect<Info[]>
    readonly indexContent: () => Effect.Effect<string>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Memory") {}

  export const layer: Layer.Layer<Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const list = Effect.fn("Memory.list")(function* (scope?: "user" | "project") {
        const rows = yield* Effect.sync(() =>
          Database.use((db) => {
            const q = db.select().from(MemoryTable)
            if (scope) return q.where(eq(MemoryTable.scope, scope)).all()
            return q.all()
          }),
        )
        return rows.map(toInfo)
      })

      const get = Effect.fn("Memory.get")(function* (id: string) {
        const row = yield* Effect.sync(() =>
          Database.use((db) => db.select().from(MemoryTable).where(eq(MemoryTable.id, id)).get()),
        )
        return row ? toInfo(row) : undefined
      })

      const add = Effect.fn("Memory.add")(function* (input: AddInput) {
        const id = ulid()
        // Try to get instance context (project-scoped memories need the worktree path)
        const ctx = yield* InstanceState.context.pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        const worktree = ctx?.worktree
        const projectId = ctx?.project.id

        const scope = input.scope ?? "user"
        const dir = scope === "project" && worktree ? path.join(worktree, ".opencode", "memory") : userMemDir()

        yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))

        const file = path.join(dir, `${id}-${slugify(input.title)}.md`)
        const tags = input.tags ?? []
        const frontmatter = [
          "---",
          `id: ${id}`,
          `type: ${input.type}`,
          `title: "${input.title}"`,
          tags.length ? `tags: [${tags.map((t) => `"${t}"`).join(", ")}]` : "",
          "---",
        ]
          .filter(Boolean)
          .join("\n")
        yield* Effect.promise(() => fs.writeFile(file, `${frontmatter}\n\n${input.content}`, "utf-8"))

        // Store relative path: project-scoped relative to worktree, user-scoped relative to home
        const base = scope === "project" && worktree ? worktree : Global.Path.home
        const rel = path.relative(base, file)

        const now = Date.now()
        const row = {
          id,
          scope,
          project_id: scope === "project" ? (projectId ?? null) : null,
          type: input.type,
          title: input.title,
          content: input.content,
          tags,
          file: rel,
          time_created: now,
          time_updated: now,
        }
        yield* Effect.sync(() => Database.use((db) => db.insert(MemoryTable).values(row).run()))
        log.info("memory added", { id, title: input.title, type: input.type })
        return toInfo(row as any)
      })

      const remove = Effect.fn("Memory.remove")(function* (id: string) {
        const mem = yield* get(id)
        if (!mem) return
        // Resolve absolute path for deletion
        const base = mem.scope === "user" ? Global.Path.home : mem.file
        const abs = path.isAbsolute(mem.file) ? mem.file : path.join(base, mem.file)
        yield* Effect.promise(() => fs.unlink(abs).catch(() => undefined))
        yield* Effect.sync(() => Database.use((db) => db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()))
        log.info("memory removed", { id })
      })

      // Keyword-based recall: score memories by overlap with query tokens
      const recall = Effect.fn("Memory.recall")(function* (query: string) {
        const all = yield* list()
        if (!all.length) return []
        const tokens = query
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 2)
        if (!tokens.length) return all.slice(0, 5)
        const scored = all.map((m) => {
          const text = `${m.title} ${m.content} ${(m.tags ?? []).join(" ")}`.toLowerCase()
          const score = tokens.filter((t) => text.includes(t)).length
          return { m, score }
        })
        return scored
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.m)
      })

      // Generate MEMORY.md index from all memories
      const indexContent = Effect.fn("Memory.indexContent")(function* () {
        const all = yield* list()
        if (!all.length) return "# Memory Index\n\n(no memories stored)\n"
        const byType = new Map<string, Info[]>()
        for (const m of all) {
          const arr = byType.get(m.type) ?? []
          arr.push(m)
          byType.set(m.type, arr)
        }
        const sections = [...byType.entries()].map(([type, items]) => {
          const entries = items.map(
            (m) => `- **${m.title}** (\`${m.id}\`): ${m.content.slice(0, 100).replace(/\n/g, " ")}`,
          )
          return `## ${type}\n\n${entries.join("\n")}`
        })
        return `# Memory Index\n\n_Auto-generated. ${all.length} ${all.length === 1 ? "memory" : "memories"}._\n\n${sections.join("\n\n")}\n`
      })

      return Service.of({ list, get, add, remove, recall, indexContent })
    }),
  )

  const { runPromise } = makeRuntime(Service, layer)

  export async function list(scope?: "user" | "project") {
    return runPromise((svc) => svc.list(scope))
  }

  export async function get(id: string) {
    return runPromise((svc) => svc.get(id))
  }

  export async function add(input: Omit<AddInput, "scope"> & { scope?: "user" | "project" }) {
    return runPromise((svc) => svc.add(AddInput.parse(input)))
  }

  export async function remove(id: string) {
    return runPromise((svc) => svc.remove(id))
  }

  export async function recall(query: string) {
    return runPromise((svc) => svc.recall(query))
  }
}
