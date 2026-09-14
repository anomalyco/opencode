import { splitProps, type ComponentProps } from "solid-js"

export function TabStateIndicator(props: ComponentProps<"svg">) {
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
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <g opacity="0.25" fill="#808080">
        <rect x="13.5" y="2.5" width="2" height="2" transform="rotate(90 13.5 2.5)" />
        <path d="M10.5 2.5L10.5 4.5L8.5 4.5L8.5 2.5L10.5 2.5Z" />
        <path d="M4.5 2.5L4.5 4.5L2.5 4.5L2.5 2.5L4.5 2.5Z" />
        <path d="M13.5 5.5L13.5 7.5L11.5 7.5L11.5 5.5L13.5 5.5Z" />
        <path d="M4.5 5.5L4.5 7.5L2.5 7.5L2.5 5.5L4.5 5.5Z" />
        <path d="M13.5 8.5L13.5 10.5L11.5 10.5L11.5 8.5L13.5 8.5Z" />
        <path d="M4.5 8.5L4.5 10.5L2.5 10.5L2.5 8.5L4.5 8.5Z" />
        <path d="M13.5 11.5L13.5 13.5L11.5 13.5L11.5 11.5L13.5 11.5Z" />
        <path d="M7.5 11.5L7.5 13.5L5.5 13.5L5.5 11.5L7.5 11.5Z" />
        <path d="M4.5 11.5L4.5 13.5L2.5 13.5L2.5 11.5L4.5 11.5Z" />
        <path d="M7.5 2.5L7.5 4.5L5.5 4.5L5.5 2.5L7.5 2.5Z" />
        <path d="M10.5 5.5L10.5 7.5L8.5 7.5L8.5 5.5L10.5 5.5Z" />
        <path d="M7.5 5.5L7.5 7.5L5.5 7.5L5.5 5.5L7.5 5.5Z" />
        <path d="M10.5 8.5L10.5 10.5L8.5 10.5L8.5 8.5L10.5 8.5Z" />
        <path d="M7.5 8.5L7.5 10.5L5.5 10.5L5.5 8.5L7.5 8.5Z" />
        <path d="M10.5 11.5L10.5 13.5L8.5 13.5L8.5 11.5L10.5 11.5Z" />
      </g>
    </svg>
  )
}
