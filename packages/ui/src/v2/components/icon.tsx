import { splitProps, type ComponentProps } from "solid-js"
import { icons, TablerIcon } from "../../components/tabler-icon"

export interface IconProps extends ComponentProps<"svg"> {
  name: keyof typeof icons | (string & {})
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [local, rest] = splitProps(props, ["name", "size"])
  const name = () => (Object.hasOwn(icons, local.name) ? (local.name as keyof typeof icons) : "plus")
  return (
    <TablerIcon
      {...rest}
      name={name()}
      size={local.size === "small" ? 14 : local.size === "large" ? 20 : 16}
      data-slot="icon-svg"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    />
  )
}
