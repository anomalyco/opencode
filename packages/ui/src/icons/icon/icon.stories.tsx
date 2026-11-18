import { For } from "solid-js"
import { artworkNames } from "../catalog"
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
