import { For } from "solid-js"
import { iconNames } from "../catalog"
import { getNewIcon } from "../new-icons"
import { Icon, type IconProps } from "./icon"

const names = iconNames().sort()

const sizes = ["small", "normal", "large"] satisfies IconProps["size"][]

type Args = Pick<IconProps, "name" | "size"> & { artwork: IconProps["artwork"] | "auto" }

function Preview(args: Args) {
  return <Icon name={args.name} size={args.size} artwork={args.artwork === "auto" ? undefined : args.artwork} />
}

const groups = [
  { label: "New artwork", names: names.filter((name) => getNewIcon(name) !== undefined) },
  { label: "Uses current artwork", names: names.filter((name) => getNewIcon(name) === undefined) },
]

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
    artwork: "auto",
  },
  argTypes: {
    name: { control: "select", options: names },
    size: { control: "select", options: sizes },
    artwork: { control: "select", options: ["auto", "current", "experimental"] },
  },
  render: Preview,
}

export const Gallery = {
  render: (args: Pick<IconProps, "size">) => (
    <div data-scrollable class="max-h-[70dvh] w-full max-w-lg overflow-auto">
      <table class="w-full table-fixed text-start text-v2-text-text-base">
        <caption class="pb-3 text-start font-medium">Desktop icon catalog · {names.length}</caption>
        <thead class="sticky top-0 bg-v2-background-bg-base">
          <tr class="border-b border-v2-border-border-base">
            <th scope="col" class="w-1/2 py-2 text-start font-medium">
              Icon name
            </th>
            <th scope="col" class="text-center font-medium">
              Current
            </th>
            <th scope="col" class="text-center font-medium">
              New icons
            </th>
          </tr>
        </thead>
        <For each={groups}>
          {(group) => (
            <tbody>
              <tr>
                <th scope="rowgroup" colSpan={3} class="pt-4 pb-2 text-start font-medium text-v2-text-text-weak">
                  {group.label} · {group.names.length}
                </th>
              </tr>
              <For each={group.names}>
                {(name) => (
                  <tr class="border-b border-v2-border-border-base">
                    <th scope="row" class="py-2 text-start font-normal">
                      <bdi dir="ltr">{name}</bdi>
                    </th>
                    <td class="text-center">
                      <Icon class="inline-block" name={name} size={args.size} artwork="current" />
                    </td>
                    <td class="text-center">
                      <Icon class="inline-block" name={name} size={args.size} artwork="experimental" />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          )}
        </For>
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
