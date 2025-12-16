import { ComponentProps, For } from "solid-js"

const outerIndices = new Set([0, 1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15])
const squares = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  x: (i % 4) * 4,
  y: Math.floor(i / 4) * 4,
  delay: Math.random() * 1.5,
  duration: 1 + Math.random() * 1,
  outer: outerIndices.has(i),
}))

export function Spinner(props: { class?: string; classList?: ComponentProps<"div">["classList"] }) {
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
              animation: `${square.outer ? "pulse-opacity-dim" : "pulse-opacity"} ${square.duration}s ease-in-out infinite`,
              "animation-delay": `${square.delay}s`,
            }}
          />
        )}
      </For>
    </svg>
  )
}
