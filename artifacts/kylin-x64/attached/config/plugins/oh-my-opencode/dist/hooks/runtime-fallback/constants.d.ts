/**
 * Runtime Fallback Hook - Constants
 *
 * Default values and configuration constants for the runtime fallback feature.
 */
import type { RuntimeFallbackConfig } from "../../config";
/**
 * Default configuration values for runtime fallback
 */
export declare const DEFAULT_CONFIG: Required<RuntimeFallbackConfig>;
/**
 * Error patterns that indicate rate limiting or temporary failures
 * These are checked in addition to HTTP status codes
 */
export declare const RETRYABLE_ERROR_PATTERNS: RegExp[];
/**
 * Hook name for identification and logging
 */
export declare const HOOK_NAME = "runtime-fallback";
