import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"
import sprite from "./app-icons/sprite.svg"
import type { IconName } from "./app-icons/types"

export type AppIconProps = JSX.SVGElementTags["svg"] & {
  id: IconName
}

export const AppIcon: Component<AppIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  return (
    <svg
      data-component="app-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${local.id}`} />
    </svg>
  )
}
