import { createSignal, createEffect, Show, onCleanup, For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

const CHEVRON_FRAMES = [
  ` ██╗      `,
  ` ╚██╗     `,
  ` ░╚██╗    `,
  ` ░██╔╝    `,
  ` ██╔╝     `,
  ` ╚═╝      `,
]

interface TransitionAnimationProps {
  active: boolean
  onComplete: () => void
}

export function TransitionAnimation(props: TransitionAnimationProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [position, setPosition] = createSignal(0)
  const [visible, setVisible] = createSignal(false)

  createEffect(() => {
    if (props.active) {
      setVisible(true)
      setPosition(0)

      // Animate the chevron across the screen
      const totalWidth = dimensions().width
      const animationDuration = 400 // ms
      const frameInterval = 16 // ~60fps
      const steps = animationDuration / frameInterval
      const stepSize = totalWidth / steps

      let currentStep = 0
      const interval = setInterval(() => {
        currentStep++
        setPosition(Math.floor(currentStep * stepSize))

        if (currentStep >= steps) {
          clearInterval(interval)
          // Short delay before completing
          setTimeout(() => {
            setVisible(false)
            props.onComplete()
          }, 50)
        }
      }, frameInterval)

      onCleanup(() => {
        clearInterval(interval)
      })
    }
  })

  return (
    <Show when={visible()}>
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={10000}
      >
        {/* Background wipe effect - fills from left */}
        <box
          position="absolute"
          top={0}
          left={0}
          width={position()}
          height="100%"
          backgroundColor={theme.background}
        />

        {/* Animated chevron */}
        <box
          position="absolute"
          top={Math.floor((dimensions().height - CHEVRON_FRAMES.length) / 2)}
          left={position()}
        >
          <For each={CHEVRON_FRAMES}>
            {(line) => (
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                {line}
              </text>
            )}
          </For>
        </box>
      </box>
    </Show>
  )
}
