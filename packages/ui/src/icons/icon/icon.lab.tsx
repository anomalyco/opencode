import { For, onCleanup } from "solid-js"
import { artworkNames } from "../catalog"
import { registerIcons } from "../registry"
import { Icon, type IconProps } from "./icon"

const names = artworkNames().sort()

const sizes = ["small", "normal", "large"] satisfies IconProps["size"][]

type Args = Pick<IconProps, "name" | "size">

function Preview(args: Args) {
  return <Icon name={args.name} size={args.size} />
}

export default {
  title: "UI/Icon",
  id: "ui-icon",
  component: Icon,
  parameters: {
    gridPreview: () => (
      <div class="grid grid-cols-4 gap-4">
        <For each={names.slice(0, 16)}>{(name) => <Icon name={name} />}</For>
      </div>
    ),
  },
  tags: ["autodocs"],
  args: {
    name: "check",
    size: "normal",
  },
  argTypes: {
    name: { control: "select", options: names },
    size: { control: "select", options: sizes },
  },
  render: Preview,
}

export const Gallery = {
  render: (args: Pick<IconProps, "size">) => (
    <div data-scrollable class="max-h-[70dvh] w-full max-w-lg overflow-auto">
      <table class="w-full table-fixed text-start text-v2-text-text-base">
        <caption class="pb-3 text-start font-medium">Desktop icon catalog · {names.length}</caption>
        <tbody>
          <For each={names}>
            {(name) => (
              <tr class="border-b border-v2-border-border-base">
                <th scope="row" class="w-3/4 py-2 text-start font-normal">
                  <bdi dir="ltr">{name}</bdi>
                </th>
                <td class="text-center">
                  <Icon class="inline-block" name={name} size={args.size} />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  ),
}

export const Playground = {}

export const Sizes = {
  render: (args: Args) => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
      <For each={sizes}>{(size) => <Preview {...args} size={size} />}</For>
    </div>
  ),
}

// Artwork outside the catalog, as a plugin declares it: one still drawing, and one that moves from its resting frame.
const registered = {
  "lab:pair": `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2.5 9V2.5H13.5V3.5M2.5 9L0.5 12.5H7.5M2.5 9H7.5" stroke="currentColor" stroke-linecap="square" stroke-linejoin="round"/>
    <path d="M11.5 12.5H13.5M9.5 5.5V14.5H15.5V5.5H9.5Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  "lab:pulse": `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor"/>
    <circle cx="8" cy="8" r="2" fill="currentColor">
      <animate attributeName="r" values="2;2;5.6;5.6" keyTimes="0;0.167;0.917;1" dur="2.4s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.167;0.917;1" dur="2.4s" repeatCount="indefinite"/>
    </circle>
    <circle cx="8" cy="8" r="2" fill="currentColor">
      <animate attributeName="r" values="2;2;0;0;2;2" keyTimes="0;0.166;0.167;0.333;0.75;1" dur="2.4s" repeatCount="indefinite"/>
    </circle>
  </svg>`,
} as const

/**
 * Registered artwork draws by name like a catalog icon: in each size, in the text color, and in step where it moves.
 * `lab:missing` is not registered, so it draws nothing and keeps its box.
 */
export const Registered = {
  render: () => {
    onCleanup(registerIcons(registered))

    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <For each={["lab:pair", "lab:pulse", "lab:missing"]}>
          {(name) => (
            <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
              <For each={sizes}>{(size) => <Icon name={name} size={size} />}</For>
              <Icon name={name} class="text-v2-state-fg-success" />
              <Icon name={name} class="text-v2-state-fg-warning" />
              <Icon name={name} style={{ outline: "1px dashed currentColor" }} />
              <bdi dir="ltr">{name}</bdi>
            </div>
          )}
        </For>
      </div>
    )
  },
}

export const Directional = {
  args: { name: "arrow-left" },
  render: (args: Args) => (
    <div style={{ display: "grid", gap: "12px" }}>
      <div dir="ltr" style={{ display: "flex", gap: "8px" }}>
        <Preview {...args} />
        <Preview {...args} name="arrow-right" />
      </div>
      <div dir="rtl" style={{ display: "flex", gap: "8px" }}>
        <Preview {...args} />
        <Preview {...args} name="arrow-right" />
      </div>
    </div>
  ),
}
