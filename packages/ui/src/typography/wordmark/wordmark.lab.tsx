import type { ComponentProps } from "solid-js"
import { Wordmark } from "./wordmark"

export default {
  title: "UI/Wordmark",
  id: "ui-wordmark",
  component: Wordmark,
  tags: ["autodocs"],
  args: { fade: true, muted: true, outline: false },
  render: (args: ComponentProps<typeof Wordmark>) => (
    <div style={{ width: "360px", color: "var(--text-base)" }}>
      <Wordmark {...args} />
    </div>
  ),
}

export const Basic = {}

export const Outline = { args: { outline: true, muted: false, fade: false } }
