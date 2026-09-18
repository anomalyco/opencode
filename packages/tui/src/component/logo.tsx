import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { logo, logoMotto, logoSchool } from "../logo"
import { resolveBrand } from "@opencode-ai/brand"

export function Logo() {
  const { theme } = useTheme()
  // 校园 harness: 校名横幅用烧入的品牌色渲染，不随主题变化
  // muc：民大红亮部/校训金/暖沙；hubu：深湖大绿亮部/青铜金/灰绿
  const brand = resolveBrand()
  const isHubu = brand.id === "hubu"
  const mucRed = RGBA.fromHex(isHubu ? "#2E9070" : "#CE3A3F")
  const mucGold = RGBA.fromHex(isHubu ? "#BC9D53" : "#D9A94E")
  const mucMuted = RGBA.fromHex(isHubu ? "#9DB5A8" : "#BCA992")

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
