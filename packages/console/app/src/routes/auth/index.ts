import { Actor } from "@opencode-ai/console-core/actor.js"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { withActor } from "~/context/auth.withActor"

export async function GET(input: APIEvent) {
  try {
    const workspaces = await withActor(async () => {
      const actor = Actor.assert("account")
      return Database.transaction(async (tx) =>
        tx
          .select({ id: WorkspaceTable.id })
          .from(UserTable)
          .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
          .where(
            and(
              eq(UserTable.accountID, actor.properties.accountID),
              isNull(UserTable.timeDeleted),
              isNull(WorkspaceTable.timeDeleted),
            ),
          ),
      )
    })
    return redirect(`/workspace/${workspaces[0].id}`)
  } catch {
    return redirect("/auth/authorize")
  }
}
