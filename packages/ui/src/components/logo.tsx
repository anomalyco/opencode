import { ComponentProps } from "solid-js"

const GRAFO_WORDMARK_LEFT =
  "M8 0h24v8H8zM0 8h8v40H0zM16 24h24v8H16zM32 32h8v16h-8zM8 48h24v8H8zM52 0h32v8H52zM52 8h8v48h-8zM84 8h8v16h-8zM60 24h24v8H60zM68 32h8v8h-8zM76 40h8v8h-8zM84 48h8v8h-8zM112 0h24v8h-24zM104 8h8v48h-8zM136 8h8v48h-8zM104 24h40v8h-40z"
const GRAFO_WORDMARK_RIGHT =
  "M156 0h40v8h-40zM156 8h8v48h-8zM164 24h24v8h-24zM216 0h24v8h-24zM208 8h8v40h-8zM240 8h8v40h-8zM216 48h24v8h-24z"
const GRAFO_WORDMARK = GRAFO_WORDMARK_LEFT + GRAFO_WORDMARK_RIGHT
const GRAFO_ACCENT = "M119 70h10v4h-10zM133 70h10v4h-10zM147 70h10v4h-10z"
const GRAFO_MARK = "M5 2h12v4H5zM1 6h4v12H1zM5 18h12v4H5zM13 10h8v4h-8zM17 14h4v4h-4z"
const GRAFO_MARK_ACCENT = "M9 10h4v4H9z"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-slot="logo-logo-mark-shadow"
        d={GRAFO_MARK + GRAFO_MARK_ACCENT}
        fill="var(--icon-weak-base)"
        transform="translate(2 2)"
      />
      <path data-slot="logo-logo-mark" d={GRAFO_MARK} fill="var(--icon-strong-base)" />
      <path data-slot="logo-logo-mark-accent" d={GRAFO_MARK_ACCENT} fill="var(--icon-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 286 86"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={GRAFO_WORDMARK + GRAFO_ACCENT} fill="var(--icon-weak-base)" transform="translate(4 4)" />
      <path d={GRAFO_WORDMARK_LEFT} fill="var(--icon-base)" />
      <path d={GRAFO_WORDMARK_RIGHT} fill="var(--icon-strong-base)" />
      <path d={GRAFO_ACCENT} fill="var(--icon-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 286 86"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <path d={GRAFO_WORDMARK + GRAFO_ACCENT} fill="var(--icon-weak-base)" transform="translate(4 4)" />
      <path d={GRAFO_WORDMARK_LEFT} fill="var(--icon-base)" />
      <path d={GRAFO_WORDMARK_RIGHT} fill="var(--icon-strong-base)" />
      <path d={GRAFO_ACCENT} fill="var(--icon-base)" />
    </svg>
  )
}
