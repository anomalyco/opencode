import { z } from "zod"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { and, Database, eq, isNull, sql } from "./drizzle"
import { Identifier } from "./identifier"
import { KeyTable } from "./schema/key.sql"
import { UserTable } from "./schema/user.sql"
import { AuthTable } from "./schema/auth.sql"

export namespace Key {
  export const list = fn(z.void(), async () => {
    const keys = await Database.use((tx) =>
      tx
        .select({
          id: KeyTable.id,
          name: KeyTable.name,
          key: KeyTable.key,
          timeUsed: KeyTable.timeUsed,
          userID: KeyTable.userID,
          email: AuthTable.subject,
        })
        .from(KeyTable)
        .innerJoin(UserTable, and(eq(KeyTable.userID, UserTable.id), eq(KeyTable.workspaceID, UserTable.workspaceID)))
        .innerJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
        .where(
          and(
            ...[
              eq(KeyTable.workspaceID, Actor.workspace()),
              isNull(KeyTable.timeDeleted),
              ...(Actor.userRole() === "admin" ? [] : [eq(KeyTable.userID, Actor.userID())]),
            ],
          ),
        )
        .orderBy(sql`${KeyTable.name} DESC`),
    )
    // only return value for user's keys
    return keys.map((key) => ({
      ...key,
      key: key.userID === Actor.userID() ? key.key : undefined,
      keyDisplay: `${key.key.slice(0, 7)}...${key.key.slice(-4)}`,
    }))
  })

  export const create = fn(
    z.object({
      userID: z.string(),
      name: z.string().min(1).max(255),
    }),
    async (input) => {
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
          workspaceID: Actor.workspace(),
          userID: input.userID,
          name,
          key: secretKey,
          timeUsed: null,
        }),
      )

      return keyID
    },
  )

  export const remove = fn(z.object({ id: z.string() }), async (input) => {
    // only admin can remove other user's keys
    await Database.use((tx) =>
      tx
        .update(KeyTable)
        .set({
          timeDeleted: sql`now()`,
        })
        .where(
          and(
            ...[
              eq(KeyTable.id, input.id),
              eq(KeyTable.workspaceID, Actor.workspace()),
              ...(Actor.userRole() === "admin" ? [] : [eq(KeyTable.userID, Actor.userID())]),
            ],
          ),
        ),
    )
  })
}
