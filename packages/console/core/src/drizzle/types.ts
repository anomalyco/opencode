import { sql } from "drizzle-orm"
import { bigint, timestamp, varchar } from "drizzle-orm/mysql-core"

export const ulid = (name: string) => varchar(name, { length: 30 })

export const workspaceColumns = {
  get id() {
    return ulid("id").notNull()
  },
  get workspaceID() {
    return ulid("workspace_id").notNull()
  },
}

export const id = () => ulid("id").notNull()

export const utc = (name: string) =>
  timestamp(name, {
    fsp: 3,
  })

export const currency = (name: string) =>
  bigint(name, {
    mode: "number",
  })

export const timestamps = {
  timeCreated: utc("time_created").notNull().defaultNow(),
  timeUpdated: utc("time_updated")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  timeDeleted: utc("time_deleted"),
}
