import { RGBA } from "@opentui/core"
import { createSignal, createUniqueId, onCleanup, type JSX } from "solid-js"
import { useTheme, selectedForeground } from "@tui/context/theme"

const [activeId, setActiveId] = createSignal<string | null>(null)

type HoverableLabelProps = {
  children: (hover: boolean, hoverFg: () => RGBA) => JSX.Element
  onClick?: () => void
  disabled?: boolean
}

export function HoverableLabel(props: HoverableLabelProps) {
  const id = createUniqueId()
  const { theme } = useTheme()
  const hoverFg = () => selectedForeground(theme)

  const isHovered = () => activeId() === id && !props.disabled

  onCleanup(() => {
    if (activeId() !== id) return
    setActiveId(null)
  })

  const handleMouseOver = () => {
    if (props.disabled) return
    setActiveId(id)
  }

  const handleMouseOut = () => {
    if (activeId() !== id) return
    setActiveId(null)
  }

  const handleClick = () => {
    if (props.disabled) return
    setActiveId(null)
    props.onClick?.()
  }

  return (
    <box
      backgroundColor={isHovered() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
      onMouseUp={handleClick}
    >
      {props.children(isHovered(), hoverFg)}
    </box>
  )
}
