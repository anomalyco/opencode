import { ComponentProps } from "solid-js"

export const ClaxedoSplash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="claxedo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="-100 -90 200 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke-linecap="round"
    >
      <path
        d="M 38,-72 A 84,84 0 1 0 38,72"
        stroke="var(--icon-strong-base)"
        stroke-width="6"
        fill="none"
      />
      <circle cx="38" cy="-72" r="5" fill="var(--icon-strong-base)" />
      <circle cx="38" cy="-72" r="2" fill="var(--background-base)" />
      <circle cx="38" cy="72" r="5" fill="var(--icon-strong-base)" />
      <circle cx="38" cy="72" r="2" fill="var(--background-base)" />
    </svg>
  )
}

export const ClaxedoLogo = (props: { class?: string }) => {
  return (
    <svg
      data-component="claxedo-logo"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="-100 -90 200 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke-linecap="round"
    >
      <path
        d="M 38,-72 A 84,84 0 1 0 38,72"
        stroke="var(--icon-base)"
        stroke-width="6"
        fill="none"
      />
      <circle cx="38" cy="-72" r="5" fill="var(--icon-base)" />
      <circle cx="38" cy="-72" r="2" fill="var(--background-base)" />
      <circle cx="38" cy="72" r="5" fill="var(--icon-base)" />
      <circle cx="38" cy="72" r="2" fill="var(--background-base)" />
    </svg>
  )
}
