
/**
 * Sanitizes JSON Schema for Gemini compatibility
 * Handles Gemini's incompatibility with certain patterns
 */
export function sanitizeGeminiJsonSchema(schema: any, visited = new Set()): any {
  if (!schema || typeof schema !== "object" || visited.has(schema)) {
    return schema;
  }
  visited.add(schema);

  const sanitized = { ...schema };

  // Handle anyOf with defaults - Gemini doesn't support default on anyOf
  if (sanitized.anyOf && sanitized.default !== undefined) {
    delete sanitized.default;
  }

  // Handle union types with defaults - Gemini doesn't support default on unions
  if (Array.isArray(sanitized.type) && sanitized.default !== undefined) {
    delete sanitized.default;
  }

  // Remove additionalProperties that Gemini doesn't handle well
  if (sanitized.additionalProperties !== undefined) {
    delete sanitized.additionalProperties;
  }

  // Sanitize string constraints that Gemini may not support
  if (sanitized.type === "string") {
    // Keep essential JSON Schema properties
    const essentialProperties = [
      // Core/Identity
      "$schema", "$id", "$ref", "$anchor", "$dynamicAnchor", "$dynamicRef", "$defs",
      // Type
      "type",
      // Validation (for strings)
      "const", "enum", "minLength", "maxLength", "pattern", "format",
      // Annotation
      "title", "description", "default", "examples",
      // Content
      "contentEncoding", "contentMediaType", "contentSchema"
    ];
    
    Object.keys(sanitized).forEach((key) => {
      // Remove custom format properties but keep standard ones
      if (key.startsWith("format") && key !== "format") {
        delete sanitized[key];
      }
      // Only remove keys that are not essential properties
      else if (!essentialProperties.includes(key)) {
        delete sanitized[key];
      }
    });
  }

  // Recursively process object properties
  if (sanitized.properties) {
    sanitized.properties = Object.fromEntries(
      Object.entries(sanitized.properties).map(([key, value]) => [
        key,
        sanitizeGeminiJsonSchema(value as any, visited),
      ]),
    );
  }

  // Recursively process array items
  if (sanitized.items) {
    sanitized.items = sanitizeGeminiJsonSchema(sanitized.items, visited);
  }

  // Recursively process anyOf/oneOf/allOf
  ["anyOf", "oneOf", "allOf"].forEach((combiner) => {
    if (Array.isArray(sanitized[combiner])) {
      sanitized[combiner] = sanitized[combiner].map((item: any) =>
        sanitizeGeminiJsonSchema(item, visited)
      );
    }
  });

  return sanitized;
}
