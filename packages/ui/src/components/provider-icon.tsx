import type { Component, JSX } from "solid-js"
import { Show, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames, type IconName } from "./provider-icons/types"
import { TablerIcon } from "./tabler-icon"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  return (
    <Show
      when={local.id !== "synthetic" && local.id !== "dinference" && iconNames.includes(local.id as IconName)}
      fallback={
        <TablerIcon
          name={local.id === "dinference" ? "console" : "provider"}
          data-component="provider-icon"
          {...rest}
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
          }}
        />
      }
    >
      <svg
        data-component="provider-icon"
        {...rest}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        <use href={`${sprite}#${local.id}`} />
      </svg>
    </Show>
  )
}
