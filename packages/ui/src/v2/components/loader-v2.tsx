import { splitProps, type ComponentProps } from "solid-js"
import "./loader-v2.css"

export function LoaderV2(props: ComponentProps<"svg">) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height"])
  return (
    <svg
      {...rest}
      class={local.class}
      classList={local.classList}
      width={local.width ?? 16}
      height={local.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-component="loader-v2"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <circle cx="8" cy="8" r="6" data-slot="loader-v2-background" stroke-width="2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        data-slot="loader-v2-progress"
        pathLength="100"
        stroke-width="2"
        stroke-dasharray="33 67"
      />
    </svg>
  )
}
