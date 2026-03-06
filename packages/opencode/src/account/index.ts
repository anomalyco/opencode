import { eq, sql, isNotNull } from "drizzle-orm"
import { Database } from "@/storage/db"
import { AccountTable } from "./account.sql"
import z from "zod"

export namespace Account {
  export const Account = z.object({
    id: z.string(),
    email: z.string(),
    url: z.string(),
    org_id: z.string().nullable(),
  })
  export type Account = z.infer<typeof Account>

  function fromRow(row: (typeof AccountTable)["$inferSelect"]): Account {
    return {
      id: row.id,
      email: row.email,
      url: row.url,
      org_id: row.org_id,
    }
  }

  export function active(): Account | undefined {
    const row = Database.use((db) => db.select().from(AccountTable).where(isNotNull(AccountTable.org_id)).get())
    return row ? fromRow(row) : undefined
  }

  export function list(): Account[] {
    return Database.use((db) => db.select().from(AccountTable).all().map(fromRow))
  }

  export function remove(accountID: string) {
    Database.use((db) => db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run())
  }

  export function use(accountID: string, orgID: string | null) {
    Database.use((db) =>
      db.update(AccountTable).set({ org_id: orgID }).where(eq(AccountTable.id, accountID)).run(),
    )
  }

  export async function orgs(accountID: string): Promise<{ id: string; name: string }[]> {
    const row = Database.use((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get())
    if (!row) return []

    const access = await token(accountID)
    if (!access) return []

    const res = await fetch(`${row.url}/api/orgs`, {
      headers: { authorization: `Bearer ${access}` },
    })

    if (!res.ok) return []

    const json = (await res.json()) as Array<{ id?: string; name?: string }>
    return json.map((x) => ({ id: x.id ?? "", name: x.name ?? "" }))
  }

  export async function config(accountID: string, orgID: string): Promise<Record<string, unknown> | undefined> {
    const row = Database.use((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get())
    if (!row) return undefined

    const access = await token(accountID)
    if (!access) return undefined

    const res = await fetch(`${row.url}/api/config`, {
      headers: { authorization: `Bearer ${access}`, "x-org-id": orgID },
    })

    if (!res.ok) return undefined
    const result = (await res.json()) as Record<string, any>
    return result.config
  }

  export async function token(accountID: string): Promise<string | undefined> {
    const row = Database.use((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get())
    if (!row) return undefined
    if (row.token_expiry && row.token_expiry > Date.now()) return row.access_token

    const res = await fetch(`${row.url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: row.refresh_token,
      }).toString(),
    })

    if (!res.ok) return

    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    Database.use((db) =>
      db
        .update(AccountTable)
        .set({
          access_token: json.access_token,
          refresh_token: json.refresh_token ?? row.refresh_token,
          token_expiry: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
        })
        .where(eq(AccountTable.id, row.id))
        .run(),
    )

    return json.access_token
  }

  export type Login = {
    code: string
    user: string
    url: string
    server: string
    expiry: number
    interval: number
  }

  export async function login(url?: string): Promise<Login> {
    const server = url ?? "https://web-14275-d60e67f5-pyqs0590.onporter.run"
    const res = await fetch(`${server}/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "opencode-cli" }),
    })

    if (!res.ok) throw new Error(`Failed to initiate device flow: ${await res.text()}`)

    const json = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri_complete: string
      expires_in: number
      interval: number
    }

    const full = `${server}${json.verification_uri_complete}`

    return {
      code: json.device_code,
      user: json.user_code,
      url: full,
      server,
      expiry: json.expires_in,
      interval: json.interval,
    }
  }

  export async function poll(
    input: Login,
  ): Promise<
    | { type: "success"; email: string }
    | { type: "pending" }
    | { type: "slow" }
    | { type: "expired" }
    | { type: "denied" }
    | { type: "error"; msg: string }
  > {
    const res = await fetch(`${input.server}/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: input.code,
        client_id: "opencode-cli",
      }),
    })

    const json = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }

    if (json.access_token) {
      const me = await fetch(`${input.server}/api/user`, {
        headers: { authorization: `Bearer ${json.access_token}` },
      })
      const user = (await me.json()) as { id?: string; email?: string }
      if (!user.id || !user.email) {
        return { type: "error", msg: "No id or email in response" }
      }
      const id = user.id
      const email = user.email

      const access = json.access_token
      const expiry = Date.now() + json.expires_in! * 1000
      const refresh = json.refresh_token ?? ""

      // Fetch orgs and get first one
      const orgsRes = await fetch(`${input.server}/api/orgs`, {
        headers: { authorization: `Bearer ${access}` },
      })
      const orgs = (await orgsRes.json()) as Array<{ id?: string; name?: string }>
      const firstOrgId = orgs.length > 0 ? orgs[0].id : null

      Database.use((db) => {
        db.update(AccountTable).set({ org_id: null }).run()
        db.insert(AccountTable)
          .values({
            id,
            email,
            url: input.server,
            access_token: access,
            refresh_token: refresh,
            token_expiry: expiry,
            org_id: firstOrgId,
          })
          .onConflictDoUpdate({
            target: AccountTable.id,
            set: {
              access_token: access,
              refresh_token: refresh,
              token_expiry: expiry,
              org_id: firstOrgId,
            },
          })
          .run()
      })

      return { type: "success", email }
    }

    if (json.error === "authorization_pending") {
      return { type: "pending" }
    }

    if (json.error === "slow_down") {
      return { type: "slow" }
    }

    if (json.error === "expired_token") {
      return { type: "expired" }
    }

    if (json.error === "access_denied") {
      return { type: "denied" }
    }

    return { type: "error", msg: json.error || JSON.stringify(json) }
  }
}
