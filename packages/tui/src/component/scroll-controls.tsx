import { createSignal, onCleanup, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"

export function ScrollControls(props: { scroll: ScrollBoxRenderable }) {
  const { theme } = useTheme()
  const [canUp, setCanUp] = createSignal(false)
  const [canDown, setCanDown] = createSignal(false)
  const [hoverUp, setHoverUp] = createSignal(false)
  const [hoverDown, setHoverDown] = createSignal(false)

  const interval = setInterval(() => {
    const s = props.scroll
    if (!s) return
    setCanUp(s.y > 0)
    setCanDown(s.y < s.scrollHeight - s.height - 1)
  }, 200)
  onCleanup(() => clearInterval(interval))

  return (
    <box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      width={3}
      gap={0}
    >
      <Show when={canUp()}>
        <box
          onMouseOver={() => setHoverUp(true)}
          onMouseOut={() => setHoverUp(false)}
          onClick={() => props.scroll.scrollBy(-Math.floor(props.scroll.height / 2))}
          cursor="pointer"
        >
          <text fg={hoverUp() ? theme.text : theme.textMuted} bold={hoverUp()}>
            {" ▲ "}
          </text>
        </box>
      </Show>
      <Show when={canDown()}>
        <box
          onMouseOver={() => setHoverDown(true)}
          onMouseOut={() => setHoverDown(false)}
          onClick={() => props.scroll.scrollBy(Math.floor(props.scroll.height / 2))}
          cursor="pointer"
        >
          <text fg={hoverDown() ? theme.text : theme.textMuted} bold={hoverDown()}>
            {" ▼ "}
          </text>
        </box>
      </Show>
    </box>
  )
}
