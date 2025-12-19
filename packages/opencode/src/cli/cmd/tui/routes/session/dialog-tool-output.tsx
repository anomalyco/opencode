import { createMemo } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { MacOSScrollAccel, RGBA } from "@opentui/core"
import { CustomSpeedScroll } from "./index"

export function DialogToolOutput(props: { tool: string; output: string; onClose: () => void }) {
  const { theme, syntax } = useTheme()
  const sync = useSync()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose()
      event.preventDefault()
    }
  })

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }
    return new CustomSpeedScroll(3)
  })

  const width = createMemo(() => Math.floor(dimensions().width * 0.9))
  const height = createMemo(() => Math.floor(dimensions().height * 0.8))

  return (
    <box
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClose()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      justifyContent="center"
      position="absolute"
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e) => e.stopPropagation()}
        width={width()}
        height={height()}
        backgroundColor={theme.backgroundPanel}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
      >
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={theme.text}>
            <b>{props.tool}</b>
          </text>
        </box>
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          viewportOptions={{ paddingRight: 1, paddingLeft: 2 }}
          verticalScrollbarOptions={{
            paddingLeft: 1,
            visible: true,
            trackOptions: {
              backgroundColor: theme.backgroundElement,
              foregroundColor: theme.border,
            },
          }}
        >
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={false}
            syntaxStyle={syntax()}
            content={props.output}
            conceal={false}
            fg={theme.text}
          />
        </scrollbox>
      </box>
    </box>
  )
}
