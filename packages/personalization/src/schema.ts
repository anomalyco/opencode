import { customType, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const vecCol = customType<{
  data: Float32Array
  driverData: Buffer
}>({
  dataType() {
    return "blob"
  },
  toDriver(val: Float32Array): Buffer {
    return Buffer.from(val.buffer, val.byteOffset, val.byteLength)
  },
  fromDriver(val: Buffer): Float32Array {
    const arBuf = val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength)
    return new Float32Array(arBuf)
  },
})

export const user_profile = sqliteTable("user_profile", {
  user_id: text().primaryKey(),
  profile_json: text({ mode: "json" }),
  user_vector: vecCol(),
  update_count: integer().default(0),
  created_at: integer().notNull().$default(() => Date.now()),
  updated_at: integer().notNull().$default(() => Date.now()),
})

export const personalization_memory = sqliteTable("personalization_memory", {
  id: text().primaryKey(),
  user_id: text().notNull().references(() => user_profile.user_id, { onDelete: "cascade" }),
  tier: text().$type<"semantic" | "preference" | "working">().notNull(),
  category: text().notNull(),
  content: text().notNull(),
  confidence: real().default(1.0),
  access_count: integer().default(0),
  embedding: vecCol(),
  metadata: text({ mode: "json" }),
  created_at: integer().notNull().$default(() => Date.now()),
  updated_at: integer().notNull().$default(() => Date.now()),
  expires_at: integer(),
})

export const developer_behavior_event = sqliteTable("developer_behavior_event", {
  id: text().primaryKey(),
  user_id: text().notNull(),
  session_id: text(),
  event_type: text().$type<"prompt_correction" | "diff_accepted" | "diff_rejected" | "tool_invoked" | "explicit_preference">().notNull(),
  context_text: text().notNull(),
  inferred_key: text(),
  inferred_value: text(),
  weight: real().default(1.0),
  applied: integer({ mode: "boolean" }).default(false),
  created_at: integer().notNull().$default(() => Date.now()),
})
