import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Todo } from "../../src/session/todo"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const root = LayerNode.group([Todo.node, EventV2Bridge.node, Database.node])
const it = testEffect(LayerNode.compile(root, []))

function todoInfo(content: string, status: "pending" | "completed" = "pending"): Todo.Info {
  return { content, status, priority: "medium" }
}

// Create a project + session row so the todo insert satisfies its foreign keys.
const withSession = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const worktree = AbsolutePath.make(`/tmp/opencode-todo-${sessionID}`)
    const projectID = ProjectV2.ID.make(`proj-${sessionID}`)
    yield* db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree,
        sandboxes: [],
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: sessionID,
        directory: worktree,
        title: "todo test",
        version: "0.0.0-test",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
  })

it.live("concurrent todowrite updates do not crash on SQLITE_BUSY (#40020)", () =>
  Effect.gen(function* () {
    const sessionID = SessionID.create()
    yield* withSession(sessionID)

    // Two subagents call todowrite in parallel, each replacing the todo list.
    // The delete-then-insert transaction conflicts on the SQLite write lock;
    // the retry must absorb SQLITE_BUSY instead of orDie-ing into a defect.
    const results = yield* Effect.all(
      [
        Todo.Service.use((svc) =>
          svc.update({ sessionID, todos: [todoInfo("task-a"), todoInfo("task-b")] }),
        ),
        Todo.Service.use((svc) =>
          svc.update({ sessionID, todos: [todoInfo("task-c"), todoInfo("task-d"), todoInfo("task-e")] }),
        ),
      ],
      { concurrency: 2 },
    ).pipe(Effect.exit)

    expect(Exit.isSuccess(results)).toBe(true)

    // The surviving write is one of the two (last-writer-wins is acceptable).
    const todos = yield* Todo.Service.use((svc) => svc.get(sessionID))
    const contents = todos.map((t) => t.content)
    expect(
      contents.every((c) => ["task-a", "task-b", "task-c", "task-d", "task-e"].includes(c)),
    ).toBe(true)
    expect(contents.length).toBeGreaterThan(0)
  }),
)

it.live("todowrite persists a full replace of the todo list", () =>
  Effect.gen(function* () {
    const sessionID = SessionID.create()
    yield* withSession(sessionID)

    yield* Todo.Service.use((svc) => svc.update({ sessionID, todos: [todoInfo("a"), todoInfo("b")] }))
    yield* Todo.Service.use((svc) => svc.update({ sessionID, todos: [todoInfo("c")] }))

    const todos = yield* Todo.Service.use((svc) => svc.get(sessionID))
    expect(todos.map((t) => t.content)).toEqual(["c"])
  }),
)

it.live("todowrite with an empty list clears the todo table", () =>
  Effect.gen(function* () {
    const sessionID = SessionID.create()
    yield* withSession(sessionID)

    yield* Todo.Service.use((svc) => svc.update({ sessionID, todos: [todoInfo("a")] }))
    yield* Todo.Service.use((svc) => svc.update({ sessionID, todos: [] }))

    const todos = yield* Todo.Service.use((svc) => svc.get(sessionID))
    expect(todos).toEqual([])
  }),
)
