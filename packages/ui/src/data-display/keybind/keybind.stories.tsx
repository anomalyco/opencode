import { For } from "solid-js"
import { Keybind, type KeybindProps } from "./keybind"

const variants = ["neutral", "ghost", "outline"] satisfies KeybindProps["variant"][]

type Args = { keys: string; variant: KeybindProps["variant"] }

function Preview(args: Args) {
  return <Keybind keys={args.keys.trim().split(/\s+/).filter(Boolean)} variant={args.variant} />
}

const docs = `### Overview
Inline keybind indicator that renders one or more keyboard keys in a compact row.

### API
- \`keys\`: Array of key labels to display. Separate labels with spaces in the preview.
- Inherits native div attributes.

### Variants
- Neutral — each key sits on a gray pill with darker text.
- Ghost — keys render without a background, with lighter text.
- Outline — each key has an inset border and no background, with the dimensions of Neutral.`

export default {
  title: "UI/Keybind",
  id: "ui-keybind",
  component: Keybind,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "200px",
    frameBackground: "#fff",
    docs: { description: { component: docs } },
  },
  args: { keys: "⌘", variant: "neutral" },
  argTypes: {
    variant: { control: "select", options: variants },
  },
  render: Preview,
}

export const Playground = {}

export const Variants = {
  render: (args: Args) => (
    <div class="flex items-center gap-6">
      <For each={variants}>{(variant) => <Preview {...args} variant={variant} />}</For>
    </div>
  ),
}

export const MultipleKeys = {
  args: { keys: "⌘ K" },
  render: (args: Args) => (
    <div class="flex items-center gap-6">
      <For each={variants}>{(variant) => <Preview {...args} variant={variant} />}</For>
      <Keybind keys={["Ctrl", "B"]} variant="neutral" />
      <Keybind keys={["Ctrl", "B"]} variant="ghost" />
    </div>
  ),
}

export const AllExamples = {
  render: (args: Args) => (
    <div class="grid gap-4">
      <For each={variants}>
        {(variant) => (
          <div class="flex items-center gap-6">
            <span class="w-[50px] text-xs text-text-weak capitalize">{variant}</span>
            <For each={[args.keys, "⌘ K", "⌘ ⇧ P", "Ctrl Shift B"]}>
              {(keys) => <Preview keys={keys} variant={variant} />}
            </For>
          </div>
        )}
      </For>
    </div>
  ),
}
