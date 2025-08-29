import { useSession } from "vinxi/http"
import { createClient } from "@openauthjs/openauth/client"
import { getRequestEvent } from "solid-js/web"
import { and, Database, eq, inArray } from "@opencode/cloud-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode/cloud-core/schema/workspace.sql.js"
import { UserTable } from "@opencode/cloud-core/schema/user.sql.js"
import { query, redirect } from "@solidjs/router"
import { AccountTable } from "@opencode/cloud-core/schema/account.sql.js"
import { Actor } from "@opencode/cloud-core/actor.js"

export async function withActor<T>(fn: () => T) {
  const actor = await getActor()
  return Actor.provide(actor.type, actor.properties, fn)
}

export const getActor = query(async (): Promise<Actor.Info> => {
  "use server"
  const evt = getRequestEvent()
  const url = new URL(evt!.request.headers.get("referer") ?? evt!.request.url)
  const auth = await useAuthSession()
  const [, workspaceHint] = url.pathname.split("/").filter((x) => x.length > 0)
  if (!workspaceHint) {
    if (auth.data.current) {
      const current = auth.data.account[auth.data.current]
      return {
        type: "account",
        properties: {
          email: current.email,
          accountID: current.id,
        },
      }
    }
    if (Object.keys(auth.data.account ?? {}).length > 0) {
      const current = Object.values(auth.data.account)[0]
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
  const accounts = Object.keys(auth.data.account)
  const result = await Database.transaction(async (tx) => {
    return await tx
      .select({
        user: UserTable,
      })
      .from(AccountTable)
      .innerJoin(UserTable, and(eq(UserTable.email, AccountTable.email)))
      .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
      .where(and(inArray(AccountTable.id, accounts), eq(WorkspaceTable.id, workspaceHint)))
      .limit(1)
      .execute()
      .then((x) => x[0])
  })
  if (result) {
    return {
      type: "user",
      properties: {
        userID: result.user.id,
        workspaceID: result.user.workspaceID,
      },
    }
  }
  throw redirect("/auth/authorize")
}, "actor")

export const AuthClient = createClient({
  clientID: "app",
  issuer: import.meta.env.VITE_AUTH_URL,
})

export interface AuthSession {
  account: Record<
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
    password: "0".repeat(32),
    name: "auth",
    cookie: {
      secure: false,
      httpOnly: true,
    },
  })
}

export function AuthProvider() { }
