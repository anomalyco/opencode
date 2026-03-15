import { ComponentProps } from "solid-js"
import mark from "../assets/brand/v.svg"
import logo from "../assets/brand/logo.svg"

export const Mark = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-mark"
      src={mark}
      alt="Veritly mark"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      src={mark}
      alt="Veritly logo"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-full"
      src={logo}
      alt="Veritly"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}
