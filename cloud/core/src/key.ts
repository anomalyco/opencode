import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { and, Database, eq, sql } from "./drizzle"
import { Identifier } from "./identifier"
import { KeyTable } from "./schema/key.sql"

export namespace Key {
  export const list = async () => {
    const user = Actor.assert("user")
    const keys = await Database.use((tx) =>
      tx
        .select({
          id: KeyTable.id,
          name: KeyTable.name,
          key: KeyTable.key,
          userID: KeyTable.userID,
          timeCreated: KeyTable.timeCreated,
          timeUsed: KeyTable.timeUsed,
        })
        .from(KeyTable)
        .where(eq(KeyTable.workspaceID, user.properties.workspaceID))
        .orderBy(sql`${KeyTable.timeCreated} DESC`),
    )
    return keys
  }

  export const create = fn(z.object({ name: z.string().min(1).max(255) }), async (input) => {
    const user = Actor.assert("user")
    const { name } = input

    // Generate secret key: sk- + 64 random characters (upper, lower, numbers)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let randomPart = ""
    for (let i = 0; i < 64; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    const secretKey = `sk-${randomPart}`

    const keyRecord = await Database.use((tx) =>
      tx
        .insert(KeyTable)
        .values({
          id: Identifier.create("key"),
          workspaceID: user.properties.workspaceID,
          userID: user.properties.userID,
          name,
          key: secretKey,
          timeUsed: null,
        })
        .returning(),
    )

    return {
      key: secretKey,
      id: keyRecord[0].id,
      name: keyRecord[0].name,
      created: keyRecord[0].timeCreated,
    }
  })

  export const remove = fn(z.object({ id: z.string() }), async (input) => {
    const user = Actor.assert("user")
    const { id } = input

    const result = await Database.use((tx) =>
      tx
        .delete(KeyTable)
        .where(and(eq(KeyTable.id, id), eq(KeyTable.workspaceID, user.properties.workspaceID)))
        .returning({ id: KeyTable.id }),
    )

    if (result.length === 0) {
      throw new Error("Key not found")
    }

    return { id: result[0].id }
  })
}
