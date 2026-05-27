import mark32 from "../assets/brand/mark-32.png"
import mark96 from "../assets/brand/mark-96.png"
import { type ComponentProps, splitProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-mark"
      src={mark96}
      alt=""
      role="presentation"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      src={mark96}
      alt=""
      role="presentation"
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <div
      data-component="logo"
      classList={{
        "inline-flex items-center gap-2": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <img src={mark32} alt="" role="presentation" class="h-6 w-6 shrink-0 rounded-md" />
      <span class="text-base font-semibold tracking-tight text-icon-strong-base">yunpat</span>
    </div>
  )
}
