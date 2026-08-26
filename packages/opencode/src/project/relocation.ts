import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable, TodoTable } from "@opencode-ai/core/session/sql"
import { EventTable } from "@opencode-ai/core/event/sql"
import { and, eq, inArray, like, or } from "drizzle-orm"
import { Effect } from "effect"

import { createPathRewriter } from "./relocation-paths"

/**
 * Migrate stored references after a project's worktree was renamed or moved
 * outside of opencode (file explorer, `mv`, IDE refactor...).
 *
 * Field evidence and rationale: docs/project-rename-move-reliability.md.
 * Session rows are updated canonically; free-form payload columns are rewritten
 * with an encoding-preserving splicer so history keeps working instead of being
 * orphaned (#23248, #34737).
 */

export interface RelocateInput {
  /** previous worktree (no longer exists on disk) */
  from: string
  /** resolved worktree of the same project at its new location */
  to: string
}

export interface RelocateResult {
  sessions: number
  messages: number
  parts: number
  todos: number
  events: number
}

export const zeroRelocation: RelocateResult = { sessions: 0, messages: 0, parts: 0, todos: 0, events: 0 }

/** sqlite binds are capped well below some session counts; chunk IN() clauses */
const BIND_CHUNK = 400

function chunk<T>(items: T[], size = BIND_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const canonical = (value: string) => value.replaceAll("\\", "/")
const relativeForm = (value: string) => canonical(value).replace(/^[A-Za-z]:/, "")
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export const relocateProjectData = Effect.fn("Project.relocate")(function* (input: RelocateInput) {
  if (samePath(input.from, input.to)) {
    return { sessions: 0, messages: 0, parts: 0, todos: 0, events: 0 } satisfies RelocateResult
  }
  const { db } = yield* Database.Service
  const rewriter = createPathRewriter(input.from, input.to)

  const fromDirectory = input.from
  const fromDirectoryFwd = canonical(input.from)
  const basename = input.from.split(/[\\/]/).filter(Boolean).pop()
  if (!basename) return { sessions: 0, messages: 0, parts: 0, todos: 0, events: 0 } satisfies RelocateResult
  const basenameLike = `%${basename}%`

  // snapshot ONLY the orphaned sessions - the ones actually keyed to the old
  // location - so event/todo scoping never touches sibling worktree history
  const staleRows = yield* db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(
      or(
        eq(SessionTable.directory, fromDirectory),
        eq(SessionTable.directory, fromDirectoryFwd),
        eq(SessionTable.path, fromDirectory),
        eq(SessionTable.path, fromDirectoryFwd),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const sessionIds = staleRows.map((row) => row.id)

  const result: RelocateResult = { sessions: 0, messages: 0, parts: 0, todos: 0, events: 0 }

  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // 1. canonical session rows
      yield* tx
        .update(SessionTable)
        .set({ directory: canonical(input.to), path: relativeForm(input.to) })
        .where(
          or(
            eq(SessionTable.directory, fromDirectory),
            eq(SessionTable.directory, fromDirectoryFwd),
            eq(SessionTable.path, fromDirectory),
            eq(SessionTable.path, fromDirectoryFwd),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      result.sessions = staleRows.length

      // 2. message bodies
      const messages = yield* tx
        .select({ id: MessageTable.id, body: MessageTable.data })
        .from(MessageTable)
        .where(like(MessageTable.data, basenameLike))
        .all()
        .pipe(Effect.orDie)
      for (const { id, body } of messages) {
        if (!rewriter.matches(body)) continue
        const next = rewriter.rewrite(body)
        if (next === body) continue
        yield* tx.update(MessageTable).set({ data: next }).where(eq(MessageTable.id, id)).run().pipe(Effect.orDie)
        result.messages++
      }

      // 3. part payloads
      const parts = yield* tx
        .select({ id: PartTable.id, body: PartTable.data })
        .from(PartTable)
        .where(like(PartTable.data, basenameLike))
        .all()
        .pipe(Effect.orDie)
      for (const { id, body } of parts) {
        if (!rewriter.matches(body)) continue
        const next = rewriter.rewrite(body)
        if (next === body) continue
        yield* tx.update(PartTable).set({ data: next }).where(eq(PartTable.id, id)).run().pipe(Effect.orDie)
        result.parts++
      }

      // 4. todos - scoped to the affected sessions (composite key by session + position)
      for (const ids of chunk(sessionIds)) {
        const todos = yield* tx
          .select({
            session_id: TodoTable.session_id,
            position: TodoTable.position,
            content: TodoTable.content,
          })
          .from(TodoTable)
          .where(and(inArray(TodoTable.session_id, ids), like(TodoTable.content, basenameLike)))
          .all()
          .pipe(Effect.orDie)
        for (const todo of todos) {
          if (!rewriter.matches(todo.content)) continue
          const next = rewriter.rewrite(todo.content)
          if (next === todo.content) continue
          yield* tx
            .update(TodoTable)
            .set({ content: next })
            .where(and(eq(TodoTable.session_id, todo.session_id), eq(TodoTable.position, todo.position)))
            .run()
            .pipe(Effect.orDie)
          result.todos++
        }
      }

      // 5. event store - scoped to the affected sessions' aggregate ids
      for (const ids of chunk(sessionIds)) {
        const events = yield* tx
          .select({ id: EventTable.id, data: EventTable.data })
          .from(EventTable)
          .where(and(inArray(EventTable.aggregate_id, ids), like(EventTable.data, basenameLike)))
          .all()
          .pipe(Effect.orDie)
        for (const event of events) {
          if (!rewriter.matches(event.data)) continue
          const next = rewriter.rewrite(event.data)
          if (next === event.data) continue
          yield* tx.update(EventTable).set({ data: next }).where(eq(EventTable.id, event.id)).run().pipe(Effect.orDie)
          result.events++
        }
      }
    }),
  )

  return result
})
