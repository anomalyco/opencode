import { ComponentProps, For } from "solid-js"

export function Spinner(props: { class?: string; classList?: ComponentProps<"div">["classList"] }) {
  const squares = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    x: (i % 4) * 4,
    y: Math.floor(i / 4) * 4,
    delay: Math.random() * 3,
    duration: 2 + Math.random() * 2,
  }))

  return (
    <svg
      viewBox="0 0 15 15"
      data-component="spinner"
      classList={{
        ...(props.classList ?? {}),
        [props.class ?? ""]: !!props.class,
      }}
      fill="currentColor"
    >
      <For each={squares}>
        {(square) => (
          <rect
            x={square.x}
            y={square.y}
            width="3"
            height="3"
            rx="1"
            style={{
              animation: `pulse-opacity ${square.duration}s ease-in-out infinite`,
              "animation-delay": `${square.delay}s`,
            }}
          />
        )}
      </For>
    </svg>
  )
}
