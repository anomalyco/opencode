import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey().default(1),
  serverUrl: text("server_url").notNull(),
  serverHostname: text("server_hostname").default("127.0.0.1"),
  serverPort: integer("server_port").default(4096),
  connectionString: text("connection_string"),
  connectionStatus: text("connection_status", { enum: ["connected", "disconnected", "connecting"] }).default(
    "disconnected",
  ),
  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date(0)),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdateFn(() => new Date()),
})

export const userSettings = sqliteTable("user_settings", {
  id: integer("id").primaryKey().default(1),
  theme: text("theme", { enum: ["light", "dark", "system"] }).default("system"),
  defaultProviderId: text("default_provider_id"),
  defaultModelId: text("default_model_id"),
  currentMode: text("current_mode").default("build"),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).default(true),
  hapticsEnabled: integer("haptics_enabled", { mode: "boolean" }).default(true),
  autoSync: integer("auto_sync", { mode: "boolean" }).default(true),
  cacheSizeLimit: integer("cache_size_limit").default(104857600), // 100MB
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdateFn(() => new Date()),
})
