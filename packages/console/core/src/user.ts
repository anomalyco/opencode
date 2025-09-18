import { z } from "zod"
import { eq } from "drizzle-orm"
import { fn } from "./util/fn"
import { Database } from "./drizzle"
import { UserTable } from "./schema/user.sql"

export namespace User {
  export const fromID = fn(z.string(), async (id) =>
    Database.transaction(async (tx) => {
      return tx
        .select()
        .from(UserTable)
        .where(eq(UserTable.id, id))
        .execute()
        .then((rows) => rows[0])
    }),
  )
}
