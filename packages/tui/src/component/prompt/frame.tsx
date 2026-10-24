import type { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { useTheme } from "../../context/theme"
import { EmptyBorder, SplitBorder } from "../../ui/border"

const paddingX = 2
const paddingY = 1

// The prompt's box: a bar in `color` down its left edge, its content padded on the element
// background, and a half-row edge below. The prompt and the paste dialog's editor both use it.
// `padBottom` pads below the content as much as above it, for a box with no footer row.
export function PromptFrame(props: { color: RGBA; padBottom?: boolean; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <box width="100%">
      <box
        width="100%"
        border={["left"]}
        borderColor={props.color}
        customBorderChars={{
          ...SplitBorder.customBorderChars,
          bottomLeft: "╹",
        }}
      >
        <box
          paddingLeft={paddingX}
          paddingRight={paddingX}
          paddingTop={paddingY}
          paddingBottom={props.padBottom ? paddingY : 0}
          flexShrink={0}
          backgroundColor={theme.backgroundElement}
          flexGrow={1}
          width="100%"
        >
          {props.children}
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={props.color}
        customBorderChars={{
          ...EmptyBorder,
          vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
        }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={theme.backgroundElement}
          customBorderChars={
            theme.backgroundElement.a !== 0
              ? {
                  ...EmptyBorder,
                  horizontal: "▀",
                }
              : {
                  ...EmptyBorder,
                  horizontal: " ",
                }
          }
        />
      </box>
    </box>
  )
}

// Rows the frame adds around its content: the padding above, below with `padBottom`, and the edge.
export function promptFrameRows(padBottom: boolean) {
  return paddingY * (padBottom ? 2 : 1) + 1
}
