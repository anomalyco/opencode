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
  if (variant === "info") return "help" as const
  return
}

export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["variant", "icon", "class", "classList"])
  const variant = () => split.variant || "normal"
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
