import { TablerIcon } from "../../components/tabler-icon"
import { splitProps, type ComponentProps } from "solid-js"

export function TabStateIndicator(props: ComponentProps<"svg">) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height"])
  return (
    <TablerIcon
      name="status"
      {...rest}
      class={local.class}
      classList={local.classList}
      width={local.width ?? 16}
      height={local.height ?? 16}
      aria-hidden={rest["aria-hidden"] ?? "true"}
    />
  )
}
