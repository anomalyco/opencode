/**
 * Kilo Gateway Configuration Constants
 * Centralized configuration for all API endpoints, headers, and settings
 */

/** Environment variable for custom Kilo API URL */
export const ENV_KILO_API_URL = "KILO_API_URL"

/** Default Kilo API URL */
export const DEFAULT_KILO_API_URL = "https://api.kilo.ai"

/** Base URL for Kilo API - can be overridden by KILO_API_URL env var */
export const KILO_API_BASE = process.env[ENV_KILO_API_URL] || DEFAULT_KILO_API_URL

/** Default base URL for OpenRouter-compatible endpoint */
export const KILO_OPENROUTER_BASE = `${KILO_API_BASE}/api/openrouter`

/** Device auth polling interval in milliseconds */
export const POLL_INTERVAL_MS = 3000

/** Default model for authenticated users */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4"

/** Default model for anonymous/free usage */
export const DEFAULT_FREE_MODEL = "minimax/minimax-m2.1:free"

/** Token expiration duration in milliseconds (1 year) */
export const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000

/** User-Agent header value for requests */
export const USER_AGENT = "opencode-kilo-provider"

/** Content-Type header value for requests */
export const CONTENT_TYPE = "application/json"

/** Default provider name */
export const DEFAULT_PROVIDER_NAME = "kilo"

/** Default API key for anonymous requests */
export const ANONYMOUS_API_KEY = "anonymous"

/** Fetch timeout for model requests in milliseconds (10 seconds) */
export const MODELS_FETCH_TIMEOUT_MS = 10 * 1000

/**
 * Header constants for KiloCode API requests
 */
export const HEADER_ORGANIZATIONID = "X-KILOCODE-ORGANIZATIONID"
export const HEADER_TASKID = "X-KILOCODE-TASKID"
export const HEADER_PROJECTID = "X-KILOCODE-PROJECTID"
export const HEADER_TESTER = "X-KILOCODE-TESTER"
export const HEADER_EDITORNAME = "X-KILOCODE-EDITORNAME"

/** Default editor name value */
export const DEFAULT_EDITOR_NAME = "Kilo CLI"

/** Environment variable name for custom editor name */
export const ENV_EDITOR_NAME = "KILOCODE_EDITOR_NAME"

/** Tester header value for suppressing warnings */
export const TESTER_SUPPRESS_VALUE = "SUPPRESS"
