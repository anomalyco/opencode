// @ts-nocheck
import { createSignal } from "solid-js"
import { Field as FieldV2 } from "./field-v2"
import { SelectV2 } from "./select-v2"

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
Single-select built on Kobalte with a **TextInput v2** trigger surface and **Menu v2** list styling.

### API
- \`placeholder\`: Shown in the trigger when nothing is selected (same idea as text inputs).
- \`options\`, \`current\`, \`onSelect\`: controlled selection (\`current\` is the selected option object).
- \`value\` / \`label\`: accessors when options are not plain strings.
- \`groupBy\`: groups options; section headers use menu group label styling.
- \`appearance\`: \`base\` (28px) or \`large\` (32px).
- \`invalid\`, \`disabled\`, \`numeric\`: match text input conventions.
`

export default {
  title: "UI V2/Select",
  id: "components-select-v2",
  component: SelectV2,
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
    appearance: "base",
  },
  argTypes: {
    placeholder: {
      control: "text",
    },
    invalid: {
      control: "boolean",
    },
    disabled: {
      control: "boolean",
    },
    appearance: {
      control: "select",
      options: ["base", "large"],
    },
  },
}

export const Playground = {
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <SelectV2
        placeholder={args.placeholder}
        invalid={args.invalid}
        disabled={args.disabled}
        appearance={args.appearance}
        options={fruits}
        current={current()}
        onSelect={(v) => setCurrent(v === null ? undefined : v)}
      />
    )
  },
}

export const Large = {
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <SelectV2
        placeholder={args.placeholder}
        invalid={args.invalid}
        disabled={args.disabled}
        appearance="large"
        options={fruits}
        current={current()}
        onSelect={(v) => setCurrent(v === null ? undefined : v)}
      />
    )
  },
}

export const Grouped = {
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <SelectV2<(typeof cities)[0]>
        placeholder={args.placeholder}
        invalid={args.invalid}
        disabled={args.disabled}
        appearance={args.appearance}
        options={cities}
        current={current()}
        onSelect={(v) => setCurrent(v === null ? undefined : v)}
        value={(x) => x.city}
        label={(x) => x.city}
        groupBy={(x) => x.region}
      />
    )
  },
}

export const Invalid = {
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <SelectV2
        placeholder={args.placeholder}
        invalid
        disabled={args.disabled}
        appearance={args.appearance}
        options={fruits}
        current={current()}
        onSelect={(v) => setCurrent(v === null ? undefined : v)}
      />
    )
  },
}

export const Disabled = {
  render: (args) => (
    <SelectV2
      placeholder={args.placeholder}
      invalid={args.invalid}
      disabled
      appearance={args.appearance}
      options={fruits}
      current="Cherry"
      onSelect={() => {}}
    />
  ),
}

export const Field = {
  parameters: { frameHeight: "500px" },
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <div style={{ width: "280px" }}>
        <FieldV2>
          <FieldV2.Label tooltip="Choose one of the available options.">Fruit</FieldV2.Label>
          <FieldV2.Prefix>Optional helper</FieldV2.Prefix>
          <SelectV2
            placeholder={args.placeholder}
            invalid={args.invalid}
            disabled={args.disabled}
            appearance={args.appearance}
            options={fruits}
            current={current()}
            onSelect={(v) => setCurrent(v === null ? undefined : v)}
          />
          <FieldV2.Suffix>After selection</FieldV2.Suffix>
        </FieldV2>
      </div>
    )
  },
}
