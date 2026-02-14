// ============================================================================
// Plugin
// ============================================================================
export { KiloAuthPlugin, default } from "./plugin.js"

// ============================================================================
// Provider
// ============================================================================
export { createKilo } from "./provider.js"
export { createKiloDebug } from "./provider-debug.js"
export { kiloCustomLoader } from "./loader.js"
export { buildKiloHeaders, getEditorNameHeader, DEFAULT_HEADERS } from "./headers.js"

// ============================================================================
// Auth
// ============================================================================
export { authenticateWithDeviceAuth } from "./auth/device-auth.js"
export { authenticateWithDeviceAuthTUI } from "./auth/device-auth-tui.js"
export { getKiloUrlFromToken, isValidKilocodeToken, getApiKey } from "./auth/token.js"
export { poll, formatTimeRemaining } from "./auth/polling.js"
export { migrateLegacyKiloAuth, LEGACY_CONFIG_PATH } from "./auth/legacy-migration.js"

// ============================================================================
// API
// ============================================================================
export {
  fetchProfile,
  fetchBalance,
  fetchProfileWithBalance,
  fetchDefaultModel,
  getKiloProfile,
  getKiloBalance,
  getKiloDefaultModel,
  promptOrganizationSelection,
} from "./api/profile.js"
export { fetchKiloModels } from "./api/models.js"
export { fetchKilocodeNotifications, type KilocodeNotification } from "./api/notifications.js"

// ============================================================================
// Server Routes (optional - requires hono and OpenCode dependencies)
// ============================================================================
export { createKiloRoutes } from "./server/routes.js"

// ============================================================================
// Note: TUI exports moved to separate entry point
// ============================================================================
// For TUI components and commands, import from "@kilocode/kilo-gateway/tui"
// This avoids circular dependencies with opencode TUI infrastructure

// ============================================================================
// Types
// ============================================================================
export type {
  // Auth types
  DeviceAuthInitiateResponse,
  DeviceAuthPollResponse,
  Organization,
  KilocodeProfile,
  KilocodeBalance,
  PollOptions,
  PollResult,
  // Provider types
  KiloProviderOptions,
  KiloMetadata,
  CustomLoaderResult,
  ProviderInfo,
  LanguageModelV2,
} from "./types.js"

// ============================================================================
// Constants
// ============================================================================
export {
  ENV_KILO_API_URL,
  DEFAULT_KILO_API_URL,
  KILO_API_BASE,
  KILO_OPENROUTER_BASE,
  POLL_INTERVAL_MS,
  DEFAULT_MODEL,
  DEFAULT_FREE_MODEL,
  TOKEN_EXPIRATION_MS,
  USER_AGENT,
  CONTENT_TYPE,
  DEFAULT_PROVIDER_NAME,
  ANONYMOUS_API_KEY,
  MODELS_FETCH_TIMEOUT_MS,
  HEADER_ORGANIZATIONID,
  HEADER_TASKID,
  HEADER_PROJECTID,
  HEADER_TESTER,
  HEADER_EDITORNAME,
  DEFAULT_EDITOR_NAME,
  ENV_EDITOR_NAME,
  TESTER_SUPPRESS_VALUE,
} from "./api/constants.js"
