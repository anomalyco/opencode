import { splitProps, type ComponentProps } from "solid-js"
import { icons, TablerIcon } from "./tabler-icon"

export interface IconProps extends ComponentProps<"svg"> {
  name: keyof typeof icons
  size?: "small" | "normal" | "medium" | "large"
}

export function Icon(props: IconProps) {
  const [local, others] = splitProps(props, ["name", "size", "class", "classList"])

  return (
    <div
      data-component="icon"
      data-size={local.size || "normal"}
      data-directional={
        local.name === "arrow-left" ||
        local.name === "arrow-right" ||
        local.name === "chevron-left" ||
        local.name === "chevron-right"
          ? true
          : undefined
      }
    >
      <TablerIcon
        name={local.name}
        data-slot="icon-svg"
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
        aria-hidden="true"
        {...others}
      />
    </div>
  )
}
