import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const UiSettingsProfileTable = sqliteTable("ui_settings_profile", {
  id: text().primaryKey(),
  name: text().notNull(),
  ...Timestamps,
})

export const UiAppSettingsTable = sqliteTable("ui_app_settings", {
  profile_id: text()
    .primaryKey()
    .references(() => UiSettingsProfileTable.id, { onDelete: "cascade" }),
  general_auto_save: integer({ mode: "boolean" }).notNull(),
  general_release_notes: integer({ mode: "boolean" }).notNull(),
  general_followup: text().notNull(),
  general_show_file_tree: integer({ mode: "boolean" }).notNull(),
  general_show_navigation: integer({ mode: "boolean" }).notNull(),
  general_show_search: integer({ mode: "boolean" }).notNull(),
  general_show_status: integer({ mode: "boolean" }).notNull(),
  general_show_terminal: integer({ mode: "boolean" }).notNull(),
  general_show_reasoning_summaries: integer({ mode: "boolean" }).notNull(),
  general_shell_tool_parts_expanded: integer({ mode: "boolean" }).notNull(),
  general_edit_tool_parts_expanded: integer({ mode: "boolean" }).notNull(),
  general_show_session_progress_bar: integer({ mode: "boolean" }).notNull(),
  general_show_custom_agents: integer({ mode: "boolean" }).notNull(),
  general_new_layout_designs: integer({ mode: "boolean" }).notNull(),
  updates_startup: integer({ mode: "boolean" }).notNull(),
  appearance_font_size: integer().notNull(),
  appearance_mono: text().notNull(),
  appearance_sans: text().notNull(),
  appearance_terminal: text().notNull(),
  permissions_auto_approve: integer({ mode: "boolean" }).notNull(),
  notifications_agent: integer({ mode: "boolean" }).notNull(),
  notifications_permissions: integer({ mode: "boolean" }).notNull(),
  notifications_errors: integer({ mode: "boolean" }).notNull(),
  sounds_agent_enabled: integer({ mode: "boolean" }).notNull(),
  sounds_agent: text().notNull(),
  sounds_permissions_enabled: integer({ mode: "boolean" }).notNull(),
  sounds_permissions: text().notNull(),
  sounds_errors_enabled: integer({ mode: "boolean" }).notNull(),
  sounds_errors: text().notNull(),
  ...Timestamps,
})

export const UiKeybindTable = sqliteTable(
  "ui_keybind",
  {
    profile_id: text()
      .notNull()
      .references(() => UiSettingsProfileTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    keybind: text().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.profile_id, table.action] })],
)

export const UiModelPreferenceTable = sqliteTable(
  "ui_model_preference",
  {
    profile_id: text()
      .notNull()
      .references(() => UiSettingsProfileTable.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    visibility: text().notNull(),
    favorite: integer({ mode: "boolean" }),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.profile_id, table.provider_id, table.model_id] })],
)

export const UiModelRecentTable = sqliteTable(
  "ui_model_recent",
  {
    profile_id: text()
      .notNull()
      .references(() => UiSettingsProfileTable.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.profile_id, table.provider_id, table.model_id] }),
    unique().on(table.profile_id, table.position),
  ],
)

export const UiModelVariantTable = sqliteTable(
  "ui_model_variant",
  {
    profile_id: text()
      .notNull()
      .references(() => UiSettingsProfileTable.id, { onDelete: "cascade" }),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    variant: text().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.profile_id, table.provider_id, table.model_id] })],
)
