import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-mark-shadow" d="M10 7V11H6V7H10Z" fill="var(--icon-weak-base)" />
      <path
        data-slot="logo-mark-frame"
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M12 13H4V3H12V13ZM10 5H6V11H10V5Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 160 32"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M20 14V22H12V14H20Z" fill="var(--icon-weak-base)" />
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M24 26H8V6H24V26ZM20 10H12V22H20V10Z"
          fill="var(--icon-strong-base)"
        />
      </g>
      <text
        x="38"
        y="24"
        fill="var(--icon-strong-base)"
        font-family="system-ui, sans-serif"
        font-size="20"
        font-weight="600"
        letter-spacing="0.02em"
      >
        Octopus
      </text>
    </svg>
  )
}
