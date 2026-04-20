import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db.pg"
import {
  AccountStateTable,
  AccountTable,
  ControlAccountTable,
  MessageTable,
  PartTable,
  PermissionTable,
  ProjectTable,
  SessionShareTable,
  SessionTable,
  TodoTable,
  WorkspaceTable,
} from "../../src/storage/schema"

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  await Database.use(async (db) => {
    await db.delete(SessionShareTable)
    await db.delete(TodoTable)
    await db.delete(PartTable)
    await db.delete(MessageTable)
    await db.delete(SessionTable)
    await db.delete(PermissionTable)
    await db.delete(WorkspaceTable)
    await db.delete(ProjectTable)
    await db.delete(AccountStateTable)
    await db.delete(AccountTable)
    await db.delete(ControlAccountTable)
  })
}
