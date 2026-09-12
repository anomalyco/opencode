import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { go, logo } from "../logo"
import { stringWidth } from "../util/string-width"

export function logoSize(width: number, height: number) {
  if (height < 12) return { width: 0, height: 0 }
  if (width < 22)
    return {
      width: Math.max(...go.right.slice(1).map((line) => stringWidth(line))),
      height: go.right.length - 1,
    }
  if (width < 44) {
    const lines = [...logo.left.slice(1), ...logo.right]
    return { width: Math.max(...lines.map((line) => stringWidth(line))), height: lines.length }
  }
  return {
    width: Math.max(
      ...logo.left.map((line, index) => stringWidth(line) + 1 + stringWidth(logo.right[index] ?? "")),
    ),
    height: logo.left.length,
  }
}

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
    <box id="home-logo">
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
