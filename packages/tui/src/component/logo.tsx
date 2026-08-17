import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { go, logo } from "../logo"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background.default, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  return (
    <box>
      {dimensions().height < 12 ? null : dimensions().width < 22 ? (
        <For each={go.right.slice(1)}>
          {(line) => <box flexDirection="row">{renderLine(line, theme.text.default, true)}</box>}
        </For>
      ) : dimensions().width < 44 ? (
        <>
          <For each={logo.left.slice(1)}>
            {(line) => <box flexDirection="row">{renderLine(line, theme.text.subdued, false)}</box>}
          </For>
          <For each={logo.right}>
            {(line) => <box flexDirection="row">{renderLine(line, theme.text.default, true)}</box>}
          </For>
        </>
      ) : (
        <For each={logo.left}>
          {(line, index) => (
            <box flexDirection="row" gap={1}>
              <box flexDirection="row">{renderLine(line, theme.text.subdued, false)}</box>
              <box flexDirection="row">{renderLine(logo.right[index()], theme.text.default, true)}</box>
            </box>
          )}
        </For>
      )}
    </box>
  )
}
