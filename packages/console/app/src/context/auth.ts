import { getRequestEvent } from "solid-js/web"
import { and, Database, eq, inArray, sql } from "@opencode/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode/console-core/schema/user.sql.js"
import { redirect } from "@solidjs/router"
import { AccountTable } from "@opencode/console-core/schema/account.sql.js"
import { Actor } from "@opencode/console-core/actor.js"

import { createClient } from "@openauthjs/openauth/client"
import { useAuthSession } from "./auth.session"

export const AuthClient = createClient({
  clientID: "app",
  issuer: import.meta.env.VITE_AUTH_URL,
})

export const getActor = async (workspace?: string): Promise<Actor.Info> => {
  "use server"
  const evt = getRequestEvent()
  if (!evt) throw new Error("No request event")
  if (evt.locals.actor) return evt.locals.actor
  evt.locals.actor = (async () => {
    const auth = await useAuthSession()
    if (!workspace) {
      const account = auth.data.account ?? {}
      const current = account[auth.data.current ?? ""]
      if (current) {
        return {
          type: "account",
          properties: {
            email: current.email,
            accountID: current.id,
          },
        }
      }
      if (Object.keys(account).length > 0) {
        const current = Object.values(account)[0]
        await auth.update((val) => ({
          ...val,
          current: current.id,
        }))
        return {
          type: "account",
          properties: {
            email: current.email,
            accountID: current.id,
          },
        }
      }
      return {
        type: "public",
        properties: {},
      }
    }
    const accounts = Object.keys(auth.data.account ?? {})
    if (accounts.length) {
      const result = await Database.use((tx) =>
        tx
          .select({
            user: UserTable,
          })
          .from(AccountTable)
          .innerJoin(UserTable, and(eq(UserTable.email, AccountTable.email)))
          .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
          .where(and(inArray(AccountTable.id, accounts), eq(WorkspaceTable.id, workspace)))
          .limit(1)
          .execute()
          .then((x) => x[0]),
      )
      if (result) {
        await Database.use((tx) =>
          tx
            .update(UserTable)
            .set({ timeSeen: sql`now()` })
            .where(eq(UserTable.id, result.user.id)),
        )
        return {
          type: "user",
          properties: {
            userID: result.user.id,
            workspaceID: result.user.workspaceID,
            role: result.user.role,
          },
        }
      }
    }
    throw redirect("/auth/authorize")
  })()
  return evt.locals.actor
}
