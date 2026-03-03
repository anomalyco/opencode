import { eq, and } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ControlAccountTable } from "./control.sql"
import z from "zod"

export * from "./control.sql"

export namespace Control {
  export const Account = z.object({
    email: z.string(),
    url: z.string(),
  })
  export type Account = z.infer<typeof Account>

  function fromRow(row: (typeof ControlAccountTable)["$inferSelect"]): Account {
    return {
      email: row.email,
      url: row.url,
    }
  }

  export function account(): Account | undefined {
    const row = Database.use((db) =>
      db.select().from(ControlAccountTable).where(eq(ControlAccountTable.active, true)).get(),
    )
    return row ? fromRow(row) : undefined
  }

  export async function token(): Promise<string | undefined> {
    const row = Database.use((db) =>
      db.select().from(ControlAccountTable).where(eq(ControlAccountTable.active, true)).get(),
    )
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
        .update(ControlAccountTable)
        .set({
          access_token: json.access_token,
          refresh_token: json.refresh_token ?? row.refresh_token,
          token_expiry: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
        })
        .where(and(eq(ControlAccountTable.email, row.email), eq(ControlAccountTable.url, row.url)))
        .run(),
    )

    return json.access_token
  }
}
