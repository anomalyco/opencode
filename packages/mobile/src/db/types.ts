import type { InferSelectModel, InferInsertModel } from "drizzle-orm"
import type {
  sessions,
  messages,
  messageParts,
  fileCache,
  appConfig,
  userSettings,
  providers,
  syncQueue,
} from "./schema"

// Select types (for reading from DB)
export type Session = InferSelectModel<typeof sessions>
export type Message = InferSelectModel<typeof messages>
export type MessagePart = InferSelectModel<typeof messageParts>
export type FileCache = InferSelectModel<typeof fileCache>
export type AppConfig = InferSelectModel<typeof appConfig>
export type UserSettings = InferSelectModel<typeof userSettings>
export type Provider = InferSelectModel<typeof providers>
export type SyncQueue = InferSelectModel<typeof syncQueue>

// Insert types (for creating new records)
export type NewSession = InferInsertModel<typeof sessions>
export type NewMessage = InferInsertModel<typeof messages>
export type NewMessagePart = InferInsertModel<typeof messageParts>
export type NewFileCache = InferInsertModel<typeof fileCache>
export type NewAppConfig = InferInsertModel<typeof appConfig>
export type NewUserSettings = InferInsertModel<typeof userSettings>
export type NewProvider = InferInsertModel<typeof providers>
export type NewSyncQueue = InferInsertModel<typeof syncQueue>
