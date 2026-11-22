import type { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { SplitBorder } from "./border"
import { spacing, type UiStyle } from "./design"

/**
 * The frame shared by transcript cards. `opencode` keeps the upstream left rule; `fork` draws the rounded card.
 * Phase 2 adds the assistant and tool variants on top of this primitive.
 */
export function MessageCard(props: {
  style: UiStyle
  borderColor: RGBA
  backgroundColor: RGBA
  children: JSX.Element
}) {
  const card = () => props.style === "fork"

  return (
    <box
      border={card() ? ["top", "right", "bottom", "left"] : ["left"]}
      borderStyle={card() ? "rounded" : undefined}
      borderColor={props.borderColor}
      customBorderChars={card() ? undefined : SplitBorder.customBorderChars}
      backgroundColor={props.backgroundColor}
      paddingLeft={card() ? spacing.xs : 0}
      paddingRight={card() ? spacing.xs : 0}
    >
      {props.children}
    </box>
  )
}
