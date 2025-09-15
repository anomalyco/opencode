import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { and, Database, eq, isNull, sql } from "./drizzle"
import { Identifier } from "./identifier"
import { KeyTable } from "./schema/key.sql"

export namespace Key {
  export const list = async () => {
    const workspace = Actor.workspace()
    const keys = await Database.use((tx) =>
      tx
        .select()
        .from(KeyTable)
        .where(and(eq(KeyTable.workspaceID, workspace), isNull(KeyTable.timeDeleted)))
        .orderBy(sql`${KeyTable.timeCreated} DESC`),
    )
    return keys
  }

  export const create = fn(z.object({ name: z.string().min(1).max(255) }), async (input) => {
    const workspaceID = Actor.workspace()
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
        workspaceID,
        actor: Actor.use(),
        name,
        key: secretKey,
        timeUsed: null,
      }),
    ).catch((e: any) => {
      if (e.message.match(/Duplicate entry '.*' for key 'key.name'/))
        throw new Error("A key with this name already exists. Please choose a different name.")
      throw e
    })

    return keyID
  })

  export const remove = fn(z.object({ id: z.string() }), async (input) => {
    const workspace = Actor.workspace()
    await Database.transaction(async (tx) => {
      const row = await tx
        .select({
          name: KeyTable.name,
        })
        .from(KeyTable)
        .where(and(eq(KeyTable.id, input.id), eq(KeyTable.workspaceID, workspace)))
        .then((rows) => rows[0])
      if (!row) return

      await tx
        .update(KeyTable)
        .set({
          timeDeleted: sql`now()`,
          oldName: row.name,
          name: input.id, // Use the key ID as the name
        })
        .where(and(eq(KeyTable.id, input.id), eq(KeyTable.workspaceID, workspace)))
    })
  })
}
