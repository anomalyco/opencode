import { createEffect, onCleanup, type ComponentProps, splitProps } from "solid-js"
import { artworkNames, isIconName, getIcon, resolveIconName, type IconName } from "../catalog"
import { isRegisteredIconName, mountRegisteredIcon, registeredIconSymbol, type RegisteredIconName } from "../registry"
import "./icon.css"

const spriteID = "opencode-v2-icon-sprite"

const symbol = (name: string) => `opencode-v2-icon-${name}`

let spriteInserted = false

function spriteContent() {
  return artworkNames()
    .map((name) => `<symbol id="${symbol(name)}" viewBox="${getIcon(name).viewBox}">${getIcon(name).body}</symbol>`)
    .join("")
}

function ensureSprite() {
  if (spriteInserted) return

  if (typeof document === "undefined") return
  // Hot reload preserves the DOM sprite, but its symbols may be from an older module.
  const existing = document.getElementById(spriteID)

  if (existing) {
    existing.innerHTML = spriteContent()
    spriteInserted = true

    return
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  svg.innerHTML = spriteContent()
  document.body.insertBefore(svg, document.body.firstChild)
  spriteInserted = true
}

export interface IconProps extends ComponentProps<"svg"> {
  /**
   * A catalog name, or the name of registered artwork (`<owner>:<name>`, see `registerIcons`). An unknown catalog name
   * draws a plus; a name whose artwork is not registered now draws nothing and keeps its box.
   */
  name: IconName | RegisteredIconName | (string & {})
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])

  const registered = () => (isRegisteredIconName(split.name) ? split.name : undefined)
  const iconName = () => resolveIconName(isIconName(split.name) ? split.name : "plus")

  const pixelSize = () => (split.size === "large" ? 20 : split.size === "small" ? 14 : 16)

  const reference = () => {
    const name = registered()

    return name ? registeredIconSymbol(name) : symbol(iconName())
  }

  // Registered artwork brings its own frame on its symbol, which fills the icon's box.
  const viewBox = () => (registered() ? undefined : getIcon(iconName()).viewBox)

  createEffect(() => {
    ensureSprite()

    const name = registered()

    if (name) onCleanup(mountRegisteredIcon(name))
  })

  return (
    <svg
      {...rest}
      data-slot="icon-svg"
      data-directional={
        iconName() === "arrow-left" ||
        iconName() === "arrow-right" ||
        iconName() === "chevron-left" ||
        iconName() === "chevron-right"
          ? ""
          : undefined
      }
      width={pixelSize()}
      height={pixelSize()}
      viewBox={viewBox()}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <use href={`#${reference()}`} />
    </svg>
  )
}
