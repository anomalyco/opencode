import { getRequestEvent } from "solid-js/web"
import { and, Database, eq, inArray, isNotNull, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { redirect } from "@solidjs/router"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { loginUrl } from "~/lib/login-redirect"

import { createClient } from "@openauthjs/openauth/client"

export const AuthClient = createClient({
  clientID: "app",
  issuer: import.meta.env.VITE_AUTH_URL,
})

import { useSession } from "@solidjs/start/http"
import { Resource } from "@opencode-ai/console-resource"

export interface AuthSession {
  account?: Record<
    string,
    {
      id: string
      email: string
    }
  >
  current?: string
}

export function useAuthSession() {
  return useSession<AuthSession>({
    password: Resource.ZEN_SESSION_SECRET.value,
    name: "auth",
    maxAge: 60 * 60 * 24 * 365,
    cookie: {
      secure: false,
      httpOnly: true,
    },
  })
}

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
      if (current) return requireBlackAccount(current)
      if (Object.keys(account).length > 0) {
        const current = Object.values(account)[0]
        await auth.update((val) => ({
          ...val,
          current: current.id,
        }))
        return requireBlackAccount(current)
      }
      return {
        type: "public",
        properties: {},
      }
    }
    const accounts = Object.keys(auth.data.account ?? {})
    if (accounts.length) {
      const blackAccounts = await Database.use((tx) =>
        tx
          .selectDistinct({ accountID: UserTable.accountID })
          .from(UserTable)
          .innerJoin(BillingTable, eq(BillingTable.workspaceID, UserTable.workspaceID))
          .where(
            and(
              inArray(UserTable.accountID, accounts),
              isNull(UserTable.timeDeleted),
              isNotNull(BillingTable.subscriptionID),
            ),
          )
          .then((rows) => rows.map((row) => row.accountID).filter((accountID): accountID is string => !!accountID)),
      )
      if (!blackAccounts.length) throw redirectToNewConsole()

      const user = await Database.use((tx) =>
        tx
          .select({
            id: UserTable.id,
            workspaceID: UserTable.workspaceID,
            accountID: UserTable.accountID,
            role: UserTable.role,
            migratedAt: WorkspaceTable.migrated_at,
          })
          .from(UserTable)
          .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
          .where(
            and(
              eq(UserTable.workspaceID, workspace),
              isNull(UserTable.timeDeleted),
              inArray(UserTable.accountID, blackAccounts),
            ),
          )
          .limit(1)
          .execute()
          .then((x) => x[0]),
      )
      if (user) {
        if (user.migratedAt) {
          const destination = Resource.ConsoleMigration.consoleUrl
          if (!destination) throw new Error("New Console URL is not configured")
          evt.response.headers.set("Cache-Control", "no-store")
          throw redirect(`${destination}/login`, {
            status: evt.request.method === "GET" || evt.request.method === "HEAD" ? 302 : 303,
            headers: { "Cache-Control": "no-store" },
          })
        }
        await Database.use((tx) =>
          tx
            .update(UserTable)
            .set({ timeSeen: sql`now()` })
            .where(and(eq(UserTable.workspaceID, workspace), eq(UserTable.id, user.id))),
        )
        return {
          type: "user",
          properties: {
            userID: user.id,
            workspaceID: user.workspaceID,
            accountID: user.accountID,
            role: user.role,
          },
        }
      }
    }
    throw redirect(loginUrl(evt.request))
  })()
  return evt.locals.actor
}

async function requireBlackAccount(account: { id: string; email: string }): Promise<Actor.Info> {
  const black = await Database.use((tx) =>
    tx
      .select({ id: UserTable.id })
      .from(UserTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, UserTable.workspaceID))
      .where(
        and(eq(UserTable.accountID, account.id), isNull(UserTable.timeDeleted), isNotNull(BillingTable.subscriptionID)),
      )
      .limit(1)
      .then((rows) => rows[0]),
  )
  if (!black) throw redirectToNewConsole()
  return {
    type: "account",
    properties: {
      email: account.email,
      accountID: account.id,
    },
  }
}

function redirectToNewConsole() {
  const destination = Resource.ConsoleMigration.consoleUrl
  if (!destination) throw new Error("New Console URL is not configured")
  return redirect(`${destination}/login`, { status: 302, headers: { "Cache-Control": "no-store" } })
}
