import path from "path"

/**
 * Coerces an unknown value to a filesystem path string.
 *
 * Accepts:
 * - string: returned as-is
 * - undefined/null: returns ""
 * - URL instance: returns pathname
 * - Object with path/cwd/value/filePath property that is a string
 * - Array of strings: joined with platform path separator
 *
 * Throws for any other type with a descriptive error.
 *
 * @param input - The value to coerce
 * @param context - Optional context for error messages (e.g., "session route normalizePath")
 * @returns A string path, or empty string for null/undefined
 */
export function coerceFsPath(input: unknown, context?: string): string {
  // Handle null/undefined
  if (input == null) {
    return ""
  }

  // Handle string (most common case)
  if (typeof input === "string") {
    return input
  }

  // Handle URL instance
  if (input instanceof URL) {
    return input.pathname
  }

  // Handle arrays (join string segments)
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return ""
    }
    // Validate all elements are strings
    for (let i = 0; i < input.length; i++) {
      if (typeof input[i] !== "string") {
        throw new TypeError(
          `coerceFsPath: array element at index ${i} is not a string (got ${typeof input[i]})${context ? ` in ${context}` : ""}`,
        )
      }
    }
    return path.join(...(input as string[]))
  }

  // Handle objects with known path-like properties
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>

    // Check for common path-like properties in order of priority
    const pathKeys = ["path", "filePath", "cwd", "value"] as const
    for (const key of pathKeys) {
      if (key in obj) {
        const value = obj[key]
        if (typeof value === "string") {
          return value
        }
        if (value == null) {
          return ""
        }
        // Property exists but is not a string or null
        throw new TypeError(
          `coerceFsPath: object.${key} is not a string (got ${typeof value})${context ? ` in ${context}` : ""}`,
        )
      }
    }

    // Object has no recognized path properties
    const keys = Object.keys(obj).slice(0, 5).join(", ")
    throw new TypeError(
      `coerceFsPath: object has no recognized path property (keys: ${keys || "none"})${context ? ` in ${context}` : ""}`,
    )
  }

  // Reject all other types
  throw new TypeError(
    `coerceFsPath: expected string or path-like object, got ${typeof input}${context ? ` in ${context}` : ""}`,
  )
}
