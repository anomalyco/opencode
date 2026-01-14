/**
 * Attempts to repair malformed JSON strings that are commonly produced by LLMs.
 *
 * This utility handles common issues like:
 * - Unquoted string values: {key: value} -> {"key": "value"}
 * - Single quotes: {'key': 'value'} -> {"key": "value"}
 * - Trailing commas: {a: 1,} -> {"a": 1}
 * - Unquoted property names: {key: "value"} -> {"key": "value"}
 *
 * @param text - The malformed JSON string to repair
 * @returns The repaired JSON string, or the original if repair fails
 */
export function repairJson(text: string): string {
  const original = text
  try {
    // First, try parsing as-is - if it works, return original
    JSON.parse(text)
    return text
  } catch {
    // Continue with repair attempts
  }

  try {
    // Step 1: Replace single quotes with double quotes (outside of strings)
    text = replaceSingleQuotes(text)

    // Step 2: Quote unquoted property names
    text = quotePropertyNames(text)

    // Step 3: Quote unquoted string values
    text = quoteUnquotedValues(text)

    // Step 4: Remove trailing commas
    text = removeTrailingCommas(text)

    // Step 5: Handle common escape issues
    text = fixEscapes(text)

    // Validate the result
    JSON.parse(text)
    return text
  } catch {
    // If repair failed, return original
    return original
  }
}

/**
 * Replace single quotes with double quotes, but only when they're used
 * as JSON string delimiters (not inside strings)
 */
function replaceSingleQuotes(text: string): string {
  let result = ""
  let inDoubleQuote = false
  let inSingleQuote = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      result += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      result += char
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      // Replace single quote with double quote
      inSingleQuote = !inSingleQuote
      result += '"'
      continue
    }

    result += char
  }

  return result
}

/**
 * Quote unquoted property names in objects
 * Handles: {foo: "bar"} -> {"foo": "bar"}
 */
function quotePropertyNames(text: string): string {
  // Match unquoted property names followed by colon
  // Negative lookbehind for quote ensures we don't match already-quoted names
  return text.replace(
    /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
    (_match, prefix, name) => `${prefix}"${name}":`
  )
}

/**
 * Quote unquoted string values
 * Handles: {"key": value} -> {"key": "value"} for identifier-like values
 */
function quoteUnquotedValues(text: string): string {
  // This regex matches:
  // - A colon (property separator)
  // - Optional whitespace
  // - An unquoted value that looks like an identifier (letters, numbers, hyphens, underscores)
  // - Followed by comma, }, or end of array/object
  // But NOT: true, false, null, or numbers

  const reserved = new Set(["true", "false", "null"])

  // Match values after colons that aren't quoted, numbers, or reserved words
  return text.replace(
    /:\s*([a-zA-Z_$][a-zA-Z0-9_$\-]*)\s*([,}\]])/g,
    (_match, value, suffix) => {
      // Don't quote reserved JSON literals
      if (reserved.has(value.toLowerCase())) {
        return `: ${value.toLowerCase()}${suffix}`
      }
      // Quote the value
      return `: "${value}"${suffix}`
    }
  )
}

/**
 * Remove trailing commas from objects and arrays
 */
function removeTrailingCommas(text: string): string {
  // Remove commas before closing braces/brackets
  return text.replace(/,\s*([}\]])/g, "$1")
}

/**
 * Fix common escape sequence issues
 */
function fixEscapes(text: string): string {
  // Fix unescaped newlines within strings (simplified approach)
  // This is a basic fix - more complex cases may need additional handling
  let result = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      result += char
      continue
    }

    if (char === '"') {
      inString = !inString
      result += char
      continue
    }

    // If we're in a string and encounter a literal newline, escape it
    if (inString && (char === "\n" || char === "\r")) {
      result += char === "\n" ? "\\n" : "\\r"
      continue
    }

    result += char
  }

  return result
}

/**
 * Attempts to repair JSON specifically for tool call arguments.
 * Uses the tool's schema to help guide the repair process.
 *
 * @param text - The malformed JSON arguments string
 * @param schema - Optional JSON schema for the tool's input (can help with type coercion)
 * @returns The repaired JSON string
 */
export function repairToolCallJson(text: string, schema?: Record<string, unknown>): string {
  // First try the generic repair
  let repaired = repairJson(text)

  // If basic repair worked, return it
  try {
    JSON.parse(repaired)
    return repaired
  } catch {
    // Continue with schema-aware repair if available
  }

  // If we have a schema, we can try more aggressive repairs
  if (schema && typeof schema === "object") {
    // Try to fix specific patterns based on schema type hints
    repaired = repairWithSchema(text, schema)
  }

  return repaired
}

/**
 * Schema-aware JSON repair
 */
function repairWithSchema(text: string, schema: Record<string, unknown>): string {
  // Get the properties from the schema if available
  const properties = schema.properties as Record<string, { type?: string; enum?: string[] }> | undefined

  if (!properties) {
    return repairJson(text)
  }

  let repaired = text

  // For each property that has an enum, try to fix unquoted enum values
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (propSchema.enum && Array.isArray(propSchema.enum)) {
      for (const enumValue of propSchema.enum) {
        if (typeof enumValue === "string") {
          // Match the property followed by the unquoted enum value
          const pattern = new RegExp(
            `("${propName}"\\s*:\\s*)${enumValue}(\\s*[,}])`,
            "gi"
          )
          repaired = repaired.replace(pattern, `$1"${enumValue}"$2`)
        }
      }
    }
  }

  return repairJson(repaired)
}
