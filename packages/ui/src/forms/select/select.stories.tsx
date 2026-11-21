import { createEffect, createSignal } from "solid-js"
import { Field } from "@opencode/ui/field"
import { Select, type SelectProps } from "./select"

const fruits = ["Apple", "Banana", "Cherry", "Date", "Elderberry"]

type Region = "North" | "South" | "East" | "West"

const cities: { city: string; region: Region }[] = [
  { city: "Boston", region: "North" },
  { city: "Miami", region: "South" },
  { city: "Atlanta", region: "South" },
  { city: "Seattle", region: "West" },
  { city: "Denver", region: "West" },
]

const docs = `### Overview
Single-select built on Kobalte with current menu styling. The trigger is inline by default, or an input field that matches the text input.

### API
- \`appearance\`: \`inline\` (default) is the borderless trigger; \`small\`, \`base\` and \`large\` are 24px, 28px and 32px input fields.
- \`surface\`: \`base\` (default), \`layer-1\` or \`invisible\` for input fields; invisible gains a fill on hover.
- \`placeholder\`: Shown in the trigger when nothing is selected (same idea as text inputs).
- \`options\`, \`current\`, \`onSelect\`: controlled selection (\`current\` is the selected option object).
- \`value\` / \`label\`: accessors when options are not plain strings.
- \`groupBy\`: groups options; section headers use menu group label styling.
- \`placement\`, \`gutter\`, \`sameWidth\`, \`flip\`, \`slide\`, \`fitViewport\`: forwarded to Kobalte popper.
- \`invalid\`, \`disabled\`, \`numeric\`: match text input conventions.
`

type Controls = Pick<
  SelectProps<string>,
  | "appearance"
  | "surface"
  | "invalid"
  | "disabled"
  | "numeric"
  | "placeholder"
  | "open"
  | "placement"
  | "gutter"
  | "sameWidth"
  | "closeOnSelection"
  | "slide"
  | "flip"
  | "fitViewport"
>

function Sample<T>(props: SelectProps<T>) {
  const [current, setCurrent] = createSignal<T | undefined>(props.current)

  const [open, setOpen] = createSignal(false)

  createEffect(() => setOpen(!!props.open))

  return (
    <Select
      {...props}
      current={current()}
      open={open()}
      onOpenChange={setOpen}
      onSelect={(value) => {
        setCurrent(() => value ?? undefined)
        props.onSelect?.(value)
      }}
    />
  )
}

function FruitSelect(props: Controls) {
  return <Sample {...props} options={fruits} />
}

export default {
  title: "UI/Select",
  id: "ui-select",
  component: Select,
  render: FruitSelect,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "420px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    placeholder: "Pick a fruit",
    invalid: false,
    disabled: false,
    numeric: false,
    appearance: "inline",
    surface: "base",
    open: false,
    placement: "bottom-end",
    gutter: 4,
    sameWidth: false,
    closeOnSelection: true,
    slide: true,
    flip: true,
    fitViewport: false,
  } satisfies Controls,
  argTypes: {
    appearance: { options: ["inline", "small", "base", "large"] },
    surface: { options: ["base", "layer-1", "invisible"] },
    placement: {
      options: [
        "top",
        "top-start",
        "top-end",
        "right",
        "right-start",
        "right-end",
        "bottom",
        "bottom-start",
        "bottom-end",
        "left",
        "left-start",
        "left-end",
      ],
    },
    gutter: { control: { type: "range", min: 0, max: 24, step: 1 } },
  },
}

export const Playground = {}

export const Grouped = {
  render: (args: Controls) => (
    <Sample {...args} options={cities} value={(x) => x.city} label={(x) => x.city} groupBy={(x) => x.region} />
  ),
}

export const Invalid = { args: { invalid: true } }

export const Disabled = {
  args: { disabled: true },
  render: (args: Controls) => <Sample {...args} options={fruits} current="Cherry" />,
}

export const Appearances = {
  args: { appearance: "small", placeholder: "Small (24px)" },
  render: (args: Controls) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <FruitSelect {...args} />
      <Sample appearance="base" placeholder="Base (28px)" options={fruits} current="Banana" />
      <Sample appearance="large" placeholder="Large (32px)" options={fruits} current="Cherry" />
      <Sample placeholder="Inline (default)" options={fruits} current="Date" />
    </div>
  ),
}

export const Surfaces = {
  args: { appearance: "base", placeholder: "Base (default)" },
  render: (args: Controls) => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <FruitSelect {...args} />
      <Sample appearance="base" surface="layer-1" placeholder="Layer 1" options={fruits} />
      <Sample appearance="base" surface="invisible" placeholder="Invisible" options={fruits} />
      <Sample appearance="base" surface="invisible" placeholder="Invisible, invalid" options={fruits} invalid />
      <Sample appearance="base" surface="invisible" placeholder="Invisible, disabled" options={fruits} disabled />
    </div>
  ),
}

export const HighlightPreview = {
  args: { appearance: "base", placeholder: "" },
  render: (args: Controls) => {
    const [shown, setShown] = createSignal<string | undefined>("Apple")

    return (
      <div style={{ display: "grid", gap: "12px", width: "280px" }}>
        <Sample
          {...args}
          options={fruits}
          current="Apple"
          onHighlight={(value) => {
            const previous = shown()
            setShown(value)

            return () => setShown(previous)
          }}
          onSelect={(value) => {
            if (!value) return
            setShown(value)
          }}
        />
        <output data-slot="select-preview">Showing {shown()}</output>
      </div>
    )
  },
}

export const WithField = {
  parameters: { frameHeight: "500px" },
  render: (args: Controls) => (
    <div style={{ width: "280px" }}>
      <Field>
        <Field.Label tooltip="Choose one of the available options.">Fruit</Field.Label>
        <Field.Prefix>Optional helper</Field.Prefix>
        <FruitSelect {...args} />
        <Field.Suffix>After selection</Field.Suffix>
      </Field>
    </div>
  ),
}
