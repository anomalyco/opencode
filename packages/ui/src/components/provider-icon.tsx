import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames } from "./provider-icons/types"
import type { IconName } from "./provider-icons/types"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: IconName | string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const resolved = () => ((iconNames as readonly string[]).includes(local.id) ? local.id : "generic")
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${resolved()}`} />
    </svg>
  )
}
