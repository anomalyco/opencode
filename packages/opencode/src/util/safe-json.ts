/**
 * Type-safe JSON parsing with consistent error handling.
 * 
 * Provides utilities for safely parsing and validating JSON strings,
 * with clear error messages for debugging.
 */

export class JSONParseError extends Error {
  constructor(
    input: string,
    public readonly cause: Error,
  ) {
    super(`Failed to parse JSON: ${cause.message}`)
    this.name = "JSONParseError"
  }
}

/**
 * Safely parse a JSON string with typed output.
 * Throws JSONParseError on invalid JSON.
 */
export function parseJSON<T = unknown>(input: string): T {
  try {
    return JSON.parse(input) as T
  } catch (err) {
    throw new JSONParseError(input, err instanceof Error ? err : new Error(String(err)))
  }
}

/**
 * Safely parse JSON string, returning a tuple [error, result].
 * Never throws; always returns a result.
 */
export function tryParseJSON<T = unknown>(
  input: string,
): [null, T] | [JSONParseError, null] {
  try {
    return [null, JSON.parse(input) as T]
  } catch (err) {
    const error = new JSONParseError(input, err instanceof Error ? err : new Error(String(err)))
    return [error, null]
  }
}

/**
 * Safely parse JSON string with optional fallback.
 * Returns fallback value if parsing fails.
 */
export function parseJSONOrDefault<T = unknown>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T
  } catch {
    return fallback
  }
}

/**
 * Type guard: check if a value is valid JSON-serializable.
 */
export function isJSONSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value)
    return true
  } catch {
    return false
  }
}

export * as SafeJSON from "./safe-json"
