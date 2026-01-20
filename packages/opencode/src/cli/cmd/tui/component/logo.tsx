import { TextAttributes, RGBA } from "@opentui/core"
import { For, Show, createMemo, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme, tint } from "@tui/context/theme"

// Shadow markers (rendered chars in parens):
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
const SHADOW_MARKER = /[_^~]/

const LOGO_LEFT = [`                   `, `█▀▀█ █▀▀█ █▀▀█ █▀▀▄`, `█__█ █__█ █^^^ █__█`, `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀`]

const LOGO_RIGHT = [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█___ █__█ █__█ █^^^`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

// 19 (LOGO_LEFT) + 1 (gap) + 19 (LOGO_RIGHT) + 3 (padding) = 42
const LOGO_MIN_WIDTH = 42

export function Logo() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const showLogo = createMemo(() => dimensions().width >= LOGO_MIN_WIDTH)

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    const elements: JSX.Element[] = []
    let i = 0

    while (i < line.length) {
      const rest = line.slice(i)
      const markerIndex = rest.search(SHADOW_MARKER)

      if (markerIndex === -1) {
        elements.push(
          <text fg={fg} attributes={attrs} selectable={false}>
            {rest}
          </text>,
        )
        break
      }

      if (markerIndex > 0) {
        elements.push(
          <text fg={fg} attributes={attrs} selectable={false}>
            {rest.slice(0, markerIndex)}
          </text>,
        )
      }

      const marker = rest[markerIndex]
      switch (marker) {
        case "_":
          elements.push(
            <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
              {" "}
            </text>,
          )
          break
        case "^":
          elements.push(
            <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
              ▀
            </text>,
          )
          break
        case "~":
          elements.push(
            <text fg={shadow} attributes={attrs} selectable={false}>
              ▀
            </text>,
          )
          break
      }

      i += markerIndex + 1
    }

    return elements
  }

  return (
    <Show when={showLogo()}>
      <box>
        <For each={LOGO_LEFT}>
          {(line, index) => (
            <box flexDirection="row" gap={1}>
              <box flexDirection="row">{renderLine(line, theme.textMuted, false)}</box>
              <box flexDirection="row">{renderLine(LOGO_RIGHT[index()], theme.text, true)}</box>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
