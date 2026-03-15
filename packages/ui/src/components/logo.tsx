import { createUniqueId, For, type ComponentProps } from "solid-js"

const WORDMARK_LINES = [
  " ███████╗ ███████╗  ██████╗ ██╗   ██╗ ██████╗  ███████╗      ██████╗  ██████╗   ██████╗  ███████╗",
  " ██╔════╝ ██╔════╝ ██╔════╝ ██║   ██║ ██╔══██╗ ██╔════╝     ██╔════╝ ██╔═══██╗  ██╔══██╗ ██╔════╝",
  " ███████╗ █████╗   ██║      ██║   ██║ ██████╔╝ █████╗       ██║      ██║   ██║  ██║  ██║ █████╗  ",
  " ╚════██║ ██╔══╝   ██║      ██║   ██║ ██╔══██╗ ██╔══╝       ██║      ██║   ██║  ██║  ██║ ██╔══╝  ",
  " ███████║ ███████╗ ╚██████╗ ╚██████╔╝ ██║  ██║ ███████╗     ╚██████╗ ╚██████╔╝  ██████╔╝ ███████╗",
  " ╚══════╝ ╚══════╝  ╚═════╝  ╚═════╝  ╚═╝  ╚═╝ ╚══════╝      ╚═════╝  ╚═════╝   ╚═════╝  ╚══════╝",
] as const

const SecureCodeWordmark = (props: {
  x: number
  y: number
  titleSize: number
}) => {
  const id = createUniqueId()
  const wordmarkShadowId = `secure-code-shadow-${id}`

  return (
    <g transform={`translate(${props.x} ${props.y})`}>
      <defs>
        <linearGradient id={wordmarkShadowId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0A1930" />
          <stop offset="100%" stop-color="#152748" />
        </linearGradient>
      </defs>

      <For each={WORDMARK_LINES}>
        {(line, index) => {
          const y = index() * (props.titleSize + 3) + props.titleSize
          return (
            <>
              <text
                x="4"
                y={String(y + 2)}
                fill="none"
                stroke={`url(#${wordmarkShadowId})`}
                stroke-width="2"
                font-family="IBM Plex Mono, monospace"
                font-size={String(props.titleSize)}
                font-weight="700"
                style={{ "white-space": "pre" }}
              >
                {line}
              </text>
              <text
                x="0"
                y={String(y)}
                fill="#F7F5EF"
                stroke="#08192E"
                stroke-width="0.9"
                paint-order="stroke fill"
                font-family="IBM Plex Mono, monospace"
                font-size={String(props.titleSize)}
                font-weight="700"
                style={{ "white-space": "pre" }}
              >
                {line}
              </text>
            </>
          )
        }}
      </For>
    </g>
  )
}

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Acompany Secure Code"
    >
      <rect width="24" height="24" fill="none" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 1380 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Acompany Secure Code"
    >
      <SecureCodeWordmark x={12} y={20} titleSize={17} />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1180 88"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-label="Acompany Secure Code"
    >
      <SecureCodeWordmark x={0} y={10} titleSize={9.1} />
    </svg>
  )
}
