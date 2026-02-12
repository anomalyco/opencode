import { ComponentProps, splitProps } from "solid-js"
import { usePlatform } from "@/context/platform"

export interface LinkProps extends Omit<ComponentProps<"a">, "href"> {
  href: string
}

export function Link(props: LinkProps) {
  const platform = usePlatform()
  const [local, rest] = splitProps(props, ["href", "children", "class"])

  return (
    <a
      href={local.href}
      class={`text-text-strong underline ${local.class ?? ""}`}
      onClick={(event) => {
        if (!local.href) return
        event.preventDefault()
        platform.openLink(local.href)
      }}
      {...rest}
    >
      {local.children}
    </a>
  )
}
