import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { logo, logoMotto, logoSchool } from "../logo"

export function Logo() {
  const { theme } = useTheme()
  // MUC harness: 校名横幅用烧入的民大红/校训金渲染，不随主题变化
  const mucRed = RGBA.fromHex("#CE3A3F")
  const mucGold = RGBA.fromHex("#D9A94E")
  const mucMuted = RGBA.fromHex("#BCA992")

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
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
      <For each={logo.left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, mucRed, true)}</box>
            <box flexDirection="row">{renderLine(logo.right[index()], mucRed, true)}</box>
          </box>
        )}
      </For>
      <box marginTop={1} flexDirection="column" alignItems="center">
        <text fg={mucGold} selectable={false}>
          {logoMotto}
        </text>
        <text fg={mucMuted} selectable={false}>
          {logoSchool}
        </text>
      </box>
    </box>
  )
}
