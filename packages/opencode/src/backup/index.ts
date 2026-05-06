import { Database } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { MessageTable, PartTable, SessionTable, TodoTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Todo } from "@/session/todo"
import { NotFoundError } from "@/storage/storage"
import { ProjectID } from "@/project/schema"
import { zod, zodObject } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { desc, eq } from "drizzle-orm"
import { Effect, Layer, Context, Schema, Types } from "effect"

export const Payload = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(MessageV2.WithParts),
  todos: Schema.Array(Todo.Info),
}).pipe(withStatics((s) => ({ zod: zod(s), zodObject: zodObject(s) })))
export type Payload = Types.DeepMutable<Schema.Schema.Type<typeof Payload>>
const decodePayload = Schema.decodeUnknownSync(Payload)

export interface Interface {
  readonly list: (projectID: ProjectID) => Effect.Effect<Session.Info[]>
  readonly exportSession: (sessionID: SessionID, projectID: ProjectID) => Effect.Effect<Payload, InstanceType<typeof NotFoundError>>
  readonly importSession: (payload: Payload, projectID: ProjectID) => Effect.Effect<SessionID>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Backup") {}

function messageValue(message: MessageV2.WithParts, sessionID: SessionID) {
  const id = MessageID.ascending()
  const { id: _id, sessionID: _sessionID, ...data } = message.info
  return {
    id,
    session_id: sessionID,
    time_created: message.info.time?.created ?? Date.now(),
    data,
  }
}

function partValue(part: MessageV2.Part, sessionID: SessionID, messageID: MessageID) {
  const { id: _id, sessionID: _sessionID, messageID: _messageID, ...data } = part
  return {
    id: PartID.ascending(),
    message_id: messageID,
    session_id: sessionID,
    data,
  }
}

export const apply = Effect.fn("Backup.apply")(function* (payload: Payload, projectID: ProjectID) {
  const sessionID = SessionID.descending()
  const info: Session.Info = {
    ...payload.info,
    id: sessionID,
    projectID,
    // Workspace identity is environment-local and should not be restored from backups.
    workspaceID: undefined,
  }
  const messages = payload.messages.map((message) => ({
    message,
    row: messageValue(message, info.id),
  }))
  const parts = messages.flatMap(({ message, row }) => message.parts.map((part) => partValue(part, info.id, row.id)))
  const todos = payload.todos.map((todo, position) => ({
    session_id: info.id,
    content: todo.content,
    status: todo.status,
    priority: todo.priority,
    position,
  }))

  yield* Effect.sync(() =>
    Database.transaction((db) => {
      const session = Session.toRow(info)
      db.insert(SessionTable).values(session).run()
      if (messages.length) db.insert(MessageTable).values(messages.map((item) => item.row)).run()
      if (parts.length) db.insert(PartTable).values(parts).run()
      if (todos.length) db.insert(TodoTable).values(todos).run()
    }),
  )
  return info.id
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const todo = yield* Todo.Service

    const list: Interface["list"] = Effect.fn("Backup.list")(function* (projectID) {
      return yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.project_id, projectID))
            .orderBy(desc(SessionTable.time_updated))
            .all()
            .map(Session.fromRow),
        ),
      )
    })

    const exportSession: Interface["exportSession"] = Effect.fn("Backup.exportSession")(function* (sessionID, projectID) {
      const info = yield* session.get(sessionID)
      if (info.projectID !== projectID) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      return {
        info,
        messages: yield* session.messages({ sessionID }),
        todos: yield* todo.get(sessionID),
      }
    })

    const importSession: Interface["importSession"] = Effect.fn("Backup.importSession")(function* (payload, projectID) {
      return yield* apply(structuredClone(decodePayload(payload)) as Payload, projectID)
    })

    return Service.of({
      list,
      exportSession,
      importSession,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(Todo.defaultLayer),
)

export * as Backup from "."
