import { type ComponentProps, splitProps } from "solid-js"

export interface DockTrayProps extends ComponentProps<"div"> {
  attach?: "none" | "top"
}

export function DockShell(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["children", "class", "classList"])
  return (
    <div
      {...rest}
      data-dock-surface="shell"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}

export function DockShellForm(props: ComponentProps<"form">) {
  const [split, rest] = splitProps(props, ["children", "class", "classList"])
  return (
    <form
      {...rest}
      data-dock-surface="shell"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </form>
  )
}

export function DockTray(props: DockTrayProps) {
  const [split, rest] = splitProps(props, ["attach", "children", "class", "classList"])
  return (
    <div
      {...rest}
      data-dock-surface="tray"
      data-dock-attach={split.attach || "none"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}
