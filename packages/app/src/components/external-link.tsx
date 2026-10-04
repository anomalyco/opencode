import { ComponentProps, splitProps } from "solid-js"

export interface ExternalLinkProps extends Omit<ComponentProps<"a">, "href"> {
  href: string
}

export function ExternalLink(props: ExternalLinkProps) {
  const [local, rest] = splitProps(props, ["href", "children", "class", "target", "rel"])

  return (
    <a
      href={local.href}
      class={`text-text-strong underline ${local.class ?? ""}`}
      target={local.target ?? "_blank"}
      rel={local.rel ?? "noopener noreferrer"}
      {...rest}
    >
      {local.children}
    </a>
  )
}
