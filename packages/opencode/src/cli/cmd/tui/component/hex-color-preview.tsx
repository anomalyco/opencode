/**
 * HexColorPreview component that displays colored squares for detected hex codes.
 * Used alongside markdown content to visualize colors mentioned in text.
 */
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { RGBA } from "@opentui/core"

// Regex to match hex color codes: #RRGGBB or #RGB
const HEX_COLOR_REGEX = /#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})\b/g

/**
 * Converts a 3-character hex to 6-character hex.
 */
function expandShortHex(hex: string): string {
  if (hex.length === 3) {
    return hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  return hex
}

/**
 * Parses a hex color string to RGBA.
 */
function hexToRgba(hex: string): RGBA {
  const expanded = expandShortHex(hex)
  const r = parseInt(expanded.substring(0, 2), 16)
  const g = parseInt(expanded.substring(2, 4), 16)
  const b = parseInt(expanded.substring(4, 6), 16)
  return RGBA.fromInts(r, g, b)
}

/**
 * Determines if foreground should be black (true) or white (false).
 */
function shouldUseBlackForeground(color: RGBA): boolean {
  const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
  return luminance > 0.5
}

/**
 * Extracts unique hex color codes from text.
 */
function extractHexColors(text: string): string[] {
  const matches = text.matchAll(HEX_COLOR_REGEX)
  const unique = new Set<string>()
  for (const match of matches) {
    unique.add(match[0].toLowerCase())
  }
  return Array.from(unique)
}

export function HexColorPreview(props: { text: string }) {
  const { theme } = useTheme()

  const colors = createMemo(() => extractHexColors(props.text))

  return (
    <Show when={colors().length > 0}>
      <box flexDirection="row" gap={1} paddingLeft={3} marginTop={1} flexWrap="wrap">
        <For each={colors()}>
          {(hex) => {
            const color = hexToRgba(hex.slice(1))
            const fg = shouldUseBlackForeground(color) ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
            return (
              <text>
                <span style={{ bg: color, fg: fg, bold: true }}> {hex} </span>
              </text>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
