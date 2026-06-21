import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const MemoryTable = sqliteTable("zero_memory", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  embedding: text("embedding").notNull(), // Serialized JSON array of float embeddings
  metadata: text("metadata"), // Serialized JSON metadata
  ...Timestamps,
})

export const CodeIndexTable = sqliteTable("zero_code_index", {
  id: text("id").primaryKey(),
  filepath: text("filepath").notNull(),
  content: text("content").notNull(),
  embedding: text("embedding").notNull(), // Serialized JSON array of float embeddings
  metadata: text("metadata"), // Serialized JSON metadata
  ...Timestamps,
})

export const SemanticCacheTable = sqliteTable("zero_semantic_cache", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  prompt_embedding: text("prompt_embedding").notNull(), // Serialized JSON array of float embeddings
  response: text("response").notNull(), // Serialized JSON representation of choice responses
  metadata: text("metadata"),
  ...Timestamps,
})
