import { Log } from "../util/log"

export namespace McpSanitize {
  const log = Log.create({ service: "mcp.sanitize" })

  /** Maximum allowed MCP response size (1MB) */
  const MAX_RESPONSE_SIZE = 1_048_576

  /** Allowed MCP content types */
  const ALLOWED_CONTENT_TYPES = new Set(["text", "image", "resource"])

  /** Patterns that could be used for prompt injection */
  const INJECTION_PATTERNS = [
    /<system>/gi,
    /<\/system>/gi,
    /<instructions>/gi,
    /<\/instructions>/gi,
    /\[SYSTEM\]/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<<SYS>>/gi,
    /<<\/SYS>>/gi,
    /<\|system\|>/gi,
    /<\|user\|>/gi,
    /<\|assistant\|>/gi,
  ]

  /** Sanitize a text string by escaping injection patterns */
  export function escapeInjectionPatterns(text: string): string {
    let sanitized = text
    for (const pattern of INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match) => {
        // Escape by inserting zero-width space to break the pattern
        return match.slice(0, 1) + "\u200B" + match.slice(1)
      })
    }
    return sanitized
  }

  /** Validate and sanitize MCP tool response */
  export function sanitizeToolResponse(response: any): any {
    if (!response) return response

    // Size check on serialized response
    const serialized = JSON.stringify(response)
    if (serialized.length > MAX_RESPONSE_SIZE) {
      log.warn("MCP response exceeds size limit", {
        size: serialized.length,
        limit: MAX_RESPONSE_SIZE,
      })
      return {
        content: [
          {
            type: "text",
            text: `[Response truncated: exceeded ${MAX_RESPONSE_SIZE} byte limit]`,
          },
        ],
        isError: true,
      }
    }

    // Validate and sanitize content array
    if (Array.isArray(response.content)) {
      response.content = response.content
        .filter((item: any) => {
          if (!item.type || !ALLOWED_CONTENT_TYPES.has(item.type)) {
            log.warn("Filtered disallowed MCP content type", {
              type: item.type,
            })
            return false
          }
          return true
        })
        .map((item: any) => {
          if (item.type === "text" && typeof item.text === "string") {
            return { ...item, text: escapeInjectionPatterns(item.text) }
          }
          if (
            item.type === "resource" &&
            typeof item.resource?.text === "string"
          ) {
            return {
              ...item,
              resource: {
                ...item.resource,
                text: escapeInjectionPatterns(item.resource.text),
              },
            }
          }
          return item
        })
    }

    return response
  }
}
