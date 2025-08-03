import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const fileCache = sqliteTable("file_cache", {
  path: text("path").primaryKey(),
  content: text("content").notNull(),
  mimeType: text("mime_type"),
  fileType: text("file_type", { enum: ["raw", "patch"] }).notNull(),
  size: integer("size"),
  gitStatus: text("git_status"),

  serverModifiedTime: integer("server_modified_time", { mode: "timestamp" }),
  cachedAt: integer("cached_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastAccessed: integer("last_accessed", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),

  accessCount: integer("access_count").default(1),
  isPinned: integer("is_pinned", { mode: "boolean" }).default(false),
})

export const searchCache = sqliteTable("search_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(),
  searchType: text("search_type", { enum: ["text", "file", "symbol"] }).notNull(),
  results: text("results").notNull(), // JSON array of results

  cachedAt: integer("cached_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date(Date.now() + 3600000)), // 1 hour TTL
})
