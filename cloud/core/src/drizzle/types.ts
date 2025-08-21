import { bigint, timestamp, varchar } from "drizzle-orm/pg-core"

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
    withTimezone: true,
  })

export const currency = (name: string) =>
  bigint(name, {
    mode: "number",
  })

export const timestamps = {
  timeCreated: utc("time_created").notNull().defaultNow(),
  timeDeleted: utc("time_deleted"),
}
