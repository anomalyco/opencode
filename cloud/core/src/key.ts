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
    let secretKey = "sk-"
    const array = new Uint32Array(64)
    crypto.getRandomValues(array)
    for (let i = 0, l = array.length; i < l; i++) {
      secretKey += chars[array[i] % chars.length]
    }
    const keyID = Identifier.create("key")

    await Database.use((tx) =>
      tx.insert(KeyTable).values({
        id: keyID,
        workspaceID: user.properties.workspaceID,
        userID: user.properties.userID,
        name,
        key: secretKey,
        timeUsed: null,
      }),
    )

    return keyID
  })

  export const remove = fn(z.object({ id: z.string() }), async (input) => {
    const user = Actor.assert("user")
    await Database.use((tx) =>
      tx.delete(KeyTable).where(and(eq(KeyTable.id, input.id), eq(KeyTable.workspaceID, user.properties.workspaceID))),
    )
  })
}
