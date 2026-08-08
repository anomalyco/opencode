import { type ComponentProps } from "solid-js"
import icon from "../assets/brand/jarvis-icon.png"
import wordmark from "../assets/brand/jarvis-wordmark.png"

export const Mark = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-mark"
      src={icon}
      alt=""
      draggable={false}
      class="object-contain"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      src={icon}
      alt=""
      draggable={false}
      class="object-contain"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <img
      data-component="logo"
      src={wordmark}
      alt="Jarvis"
      draggable={false}
      class="object-contain"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}
