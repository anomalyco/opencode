import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // project-{uuid}
  name: text("name").notNull(),
  description: text("description"),
  path: text("path").notNull(), // unique project path/identifier

  // Server connection details
  serverUrl: text("server_url").notNull(),
  serverHostname: text("server_hostname").notNull(),
  serverPort: integer("server_port").notNull(),

  // App info from /app endpoint
  appHostname: text("app_hostname"),
  appGit: integer("app_git", { mode: "boolean" }),
  appPathConfig: text("app_path_config"),
  appPathData: text("app_path_data"),
  appPathRoot: text("app_path_root"),
  appPathCwd: text("app_path_cwd"),
  appPathState: text("app_path_state"),
  appTimeInitialized: integer("app_time_initialized", { mode: "timestamp" }),

  // Connection state
  connectionStatus: text("connection_status", {
    enum: ["connected", "disconnected", "connecting"],
  }).default("disconnected"),
  lastSyncTimestamp: integer("last_sync_timestamp", { mode: "timestamp" }).$defaultFn(() => new Date(0)),

  // UI state
  isActive: integer("is_active", { mode: "boolean" }).default(false), // currently selected
  isFavorite: integer("is_favorite", { mode: "boolean" }).default(false),
  color: text("color"), // for visual distinction

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
  currentAgent: text("current_agent").default("build"),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).default(true),
  hapticsEnabled: integer("haptics_enabled", { mode: "boolean" }).default(true),
  autoSync: integer("auto_sync", { mode: "boolean" }).default(true),
  cacheSizeLimit: integer("cache_size_limit").default(104857600), // 100MB
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdateFn(() => new Date()),
})
