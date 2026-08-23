import { splitProps, type ComponentProps, type ParentProps } from "solid-js"
import "./split-button.css"

export function SplitButton(props: ParentProps<ComponentProps<"div">>) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      data-component="split-button-v2"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      {...rest}
    >
      {split.children}
    </div>
  )
}

export function SplitButtonAction(props: ComponentProps<"button">) {
  const [split, rest] = splitProps(props, ["class", "classList"])
  return (
    <button
      type="button"
      data-component="split-button-v2-action"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      {...rest}
    />
  )
}

export function SplitButtonMenuTrigger(props: ComponentProps<"button">) {
  const [split, rest] = splitProps(props, ["class", "classList"])
  return (
    <button
      type="button"
      data-component="split-button-v2-menu-trigger"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      {...rest}
    />
  )
}
