import { UIRegistry } from "./registry"
import { Log } from "../util/log"
import { getCoreMessageWidgets } from "./renderers"

export namespace MessageWidgets {
  const log = Log.create({ service: "message-widgets" })

  export interface DetectedWidget {
    widgetId: string
    match: RegExpMatchArray
    config: any
    startIndex: number
    endIndex: number
  }

  /**
   * Detect message widgets in text content
   * Returns array of detected widgets with their positions
   *
   * Supports progressive rendering: detects incomplete widgets during streaming
   * and auto-completes closing tags for smoother UX
   */
  export async function detect(
    text: string,
    options?: { allowIncomplete?: boolean },
  ): Promise<DetectedWidget[]> {
    // Combine core widgets with plugin widgets
    const coreWidgets = getCoreMessageWidgets()
    const pluginWidgets = await UIRegistry.getMessageWidgets()
    const widgets = [...coreWidgets, ...pluginWidgets]
    const detected: DetectedWidget[] = []

    for (const widget of widgets) {
      // Reset regex lastIndex for global patterns
      widget.pattern.lastIndex = 0

      let match: RegExpMatchArray | null
      while ((match = widget.pattern.exec(text)) !== null) {
        try {
          // Extract config from match
          const configStr = match[1] || match[0]
          let config: any

          // Try to parse as JSON if it looks like JSON
          if (configStr.trim().startsWith("{")) {
            config = JSON.parse(configStr)
          } else {
            config = configStr
          }

          // Allow widget to extract custom config
          if (widget.extractConfig) {
            config = widget.extractConfig(match)
          }

          // Check for duplicate (same position)
          const startIndex = match.index || 0
          const endIndex = startIndex + match[0].length
          const isDuplicate = detected.some(
            (d) =>
              d.widgetId === widget.id && d.startIndex === startIndex && d.endIndex === endIndex,
          )

          if (isDuplicate) {
            continue
          }

          detected.push({
            widgetId: widget.id,
            match,
            config,
            startIndex,
            endIndex,
          })

          log.info("detected message widget", {
            widgetId: widget.id,
            startIndex: match.index,
            endIndex: (match.index || 0) + match[0].length,
          })
        } catch (error) {
          log.error("failed to parse widget config", {
            widgetId: widget.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // If no complete matches found and allowIncomplete is true, check for incomplete widgets
      if (detected.length === 0 && options?.allowIncomplete) {
        const incompleteMatch = detectIncompleteWidget(text, widget)
        if (incompleteMatch) {
          detected.push(incompleteMatch)
        }
      }
    }

    // Remove overlapping widgets - keep only the longest/most complete one
    const deduplicated: DetectedWidget[] = []
    for (const widget of detected) {
      const overlaps = deduplicated.some(
        (existing) =>
          // Check if they overlap
          (widget.startIndex >= existing.startIndex && widget.startIndex < existing.endIndex) ||
          (widget.endIndex > existing.startIndex && widget.endIndex <= existing.endIndex) ||
          (widget.startIndex <= existing.startIndex && widget.endIndex >= existing.endIndex),
      )

      if (!overlaps) {
        deduplicated.push(widget)
      }
    }

    // Sort by start index
    return deduplicated.sort((a, b) => a.startIndex - b.startIndex)
  }

  /**
   * Detect incomplete widgets during streaming (missing closing tag)
   * Returns a widget with partially parsed config
   */
  function detectIncompleteWidget(text: string, widget: any): DetectedWidget | null {
    // Look for opening tag patterns like <steering-question id="...">
    const openTagMatch = text.match(/<([\w-]+)([^>]*)>([\s\S]*)$/)
    if (!openTagMatch) return null

    const tagName = openTagMatch[1]
    // Check if this tag name matches the widget pattern
    const widgetPattern = widget.pattern.source
    if (!widgetPattern.includes(tagName)) return null

    const contentSoFar = openTagMatch[3]

    try {
      // Try to parse incomplete JSON by auto-completing it
      let config: any
      if (contentSoFar.trim().startsWith("{")) {
        // Auto-complete JSON for parsing
        const completed = autoCompleteJSON(contentSoFar.trim())
        config = JSON.parse(completed)
        config._streaming = true // Mark as streaming
      } else {
        config = { _streaming: true, _raw: contentSoFar }
      }

      console.log("[MessageWidgets.detect] Found INCOMPLETE widget:", {
        widgetId: widget.id,
        contentLength: contentSoFar.length,
        streaming: true,
      })

      return {
        widgetId: widget.id,
        match: openTagMatch as RegExpMatchArray,
        config,
        startIndex: openTagMatch.index || 0,
        endIndex: text.length,
      }
    } catch (error) {
      // Can't parse yet, return null
      return null
    }
  }

  /**
   * Auto-complete incomplete JSON by closing open structures
   */
  function autoCompleteJSON(json: string): string {
    let result = json
    let braceCount = 0
    let bracketCount = 0
    let inString = false
    let escaped = false

    for (let i = 0; i < json.length; i++) {
      const char = json[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === "\\") {
        escaped = true
        continue
      }

      if (char === '"' && !escaped) {
        inString = !inString
        continue
      }

      if (!inString) {
        if (char === "{") braceCount++
        if (char === "}") braceCount--
        if (char === "[") bracketCount++
        if (char === "]") bracketCount--
      }
    }

    // Close any open string
    if (inString) {
      result += '"'
    }

    // Remove trailing comma if present
    result = result.replace(/,\s*$/, "")

    // Close open arrays
    for (let i = 0; i < bracketCount; i++) {
      result += "]"
    }

    // Close open objects
    for (let i = 0; i < braceCount; i++) {
      result += "}"
    }

    return result
  }

  /**
   * Split text into segments with widget markers
   * Returns array of text segments and widget positions
   *
   * Supports progressive rendering during streaming
   */
  export async function splitText(
    text: string,
    options?: { allowIncomplete?: boolean },
  ): Promise<
    Array<
      | { type: "text"; content: string }
      | {
          type: "widget"
          widgetId: string
          config: any
          match: RegExpMatchArray
          streaming?: boolean
        }
    >
  > {
    const detected = await detect(text, options)
    if (detected.length === 0) {
      return [{ type: "text", content: text }]
    }

    const segments: Array<
      | { type: "text"; content: string }
      | {
          type: "widget"
          widgetId: string
          config: any
          match: RegExpMatchArray
          streaming?: boolean
        }
    > = []

    let lastIndex = 0

    for (const widget of detected) {
      // Add text before widget
      if (widget.startIndex > lastIndex) {
        const textContent = text.substring(lastIndex, widget.startIndex)
        if (textContent.length > 0) {
          segments.push({ type: "text", content: textContent })
        }
      }

      // Add widget marker
      segments.push({
        type: "widget",
        widgetId: widget.widgetId,
        config: widget.config,
        match: widget.match,
        streaming: widget.config?._streaming || false,
      })

      lastIndex = widget.endIndex
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const textContent = text.substring(lastIndex)
      if (textContent.length > 0) {
        segments.push({ type: "text", content: textContent })
      }
    }

    return segments
  }

  /**
   * Render a message widget using plugin
   */
  export async function render(
    widgetId: string,
    config: any,
    context: Record<string, any> = {},
  ): Promise<{
    content?: string
    component?: any
    type: "text" | "markdown" | "ansi" | "html" | "component"
    error?: string
  }> {
    return UIRegistry.renderComponent(widgetId, {
      ...context,
      config,
    })
  }
}
