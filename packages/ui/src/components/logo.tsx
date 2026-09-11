import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return <img data-component="logo-mark" class={props.class} src="/logo.png" alt="" />
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return <img ref={props.ref} data-component="logo-splash" class={props.class} src="/logo.png" alt="" />
}

export const Logo = (props: { class?: string }) => {
  return <img data-component="logo-logo" class={props.class} src="/logowithbg.png" alt="" />
}
