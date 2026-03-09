import { createContext, type ComponentProps, splitProps, useContext } from "solid-js"
import { Icon, type IconProps } from "./icon"

export interface CardProps extends ComponentProps<"div"> {
  variant?: "normal" | "error" | "warning" | "success" | "info"

  /**
   * Optional card icon used by `CardTitle`.
   *
   * - `undefined`: picks a default icon based on `variant` (error/warning/info)
   * - `false`/`null`: disables the icon
   * - `Icon` name: forces a specific icon
   */
  icon?: IconProps["name"] | false | null
}

type Ctx = {
  variant: NonNullable<CardProps["variant"]>
  mode: "none" | "set" | "placeholder"
  icon?: IconProps["name"]
}

const Ctx = createContext<Ctx>()

function pick(variant: NonNullable<CardProps["variant"]>) {
  if (variant === "error") return "circle-ban-sign" as const
  if (variant === "warning") return "warning" as const
  if (variant === "success") return "circle-check" as const
  if (variant === "info") return "help" as const
  return
}

function mix(style: ComponentProps<"div">["style"], value?: string) {
  if (!value) return style
  if (!style) return { "--card-accent": value }
  if (typeof style === "string") return `${style};--card-accent:${value};`
  return { ...(style as Record<string, string | number>), "--card-accent": value }
}

export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["variant", "icon", "style", "class", "classList"])
  const variant = () => split.variant || "normal"
  const accent = () => {
    const v = variant()
    if (v === "error") return "var(--icon-critical-base)"
    if (v === "warning") return "var(--icon-warning-active)"
    if (v === "success") return "var(--icon-success-active)"
    if (v === "info") return "var(--icon-info-active)"
    return
  }
  const mode = () => {
    if (split.icon === false || split.icon === null) return "none" as const
    if (typeof split.icon === "string") return "set" as const
    return pick(variant()) ? ("set" as const) : ("placeholder" as const)
  }
  const icon = () => {
    if (split.icon === false || split.icon === null) return
    if (typeof split.icon === "string") return split.icon
    return pick(variant())
  }
  return (
    <Ctx.Provider value={{ variant: variant(), mode: mode(), icon: icon() }}>
      <div
        {...rest}
        data-component="card"
        data-variant={variant()}
        data-icon={mode()}
        style={mix(split.style, accent())}
        classList={{
          ...(split.classList ?? {}),
          [split.class ?? ""]: !!split.class,
        }}
      >
        {props.children}
      </div>
    </Ctx.Provider>
  )
}

export function CardTitle(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  const ctx = useContext(Ctx)
  const show = () => ctx?.mode !== "none"
  const name = () => ctx?.icon ?? ("dash" as const)
  const placeholder = () => !ctx?.icon
  return (
    <div
      {...rest}
      data-slot="card-title"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {show() ? (
        <span data-slot="card-title-icon" data-placeholder={placeholder() || undefined}>
          <Icon name={name()} size="small" />
        </span>
      ) : null}
      {split.children}
    </div>
  )
}

export function CardDescription(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="card-description"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}

export function CardActions(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="card-actions"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}
