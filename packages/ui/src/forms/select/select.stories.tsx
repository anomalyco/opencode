// @ts-nocheck
import { createSignal } from "solid-js"
import { Field } from "@opencode-ai/ui/field"
import { Select } from "./select"

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
Single-select built on Kobalte with an inline trigger and current menu styling.

### API
- \`placeholder\`: Shown in the trigger when nothing is selected (same idea as text inputs).
- \`options\`, \`current\`, \`onSelect\`: controlled selection (\`current\` is the selected option object).
- \`value\` / \`label\`: accessors when options are not plain strings.
- \`groupBy\`: groups options; section headers use menu group label styling.
- \`placement\`, \`gutter\`, \`sameWidth\`, \`flip\`, \`slide\`, \`fitViewport\`: forwarded to Kobalte popper.
- \`invalid\`, \`disabled\`, \`numeric\`: match text input conventions.
`

export default {
  title: "UI/Select",
  id: "ui-select",
  component: Select,
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
  },
}

export const Playground = {
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <Select
        placeholder={args.placeholder}
        invalid={args.invalid}
        disabled={args.disabled}
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
      <Select<(typeof cities)[0]>
        placeholder={args.placeholder}
        invalid={args.invalid}
        disabled={args.disabled}
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
      <Select
        placeholder={args.placeholder}
        invalid
        disabled={args.disabled}
        options={fruits}
        current={current()}
        onSelect={(v) => setCurrent(v === null ? undefined : v)}
      />
    )
  },
}

export const Disabled = {
  render: (args) => (
    <Select
      placeholder={args.placeholder}
      invalid={args.invalid}
      disabled
      options={fruits}
      current="Cherry"
      onSelect={() => {}}
    />
  ),
}

export const WithField = {
  parameters: { frameHeight: "500px" },
  render: (args) => {
    const [current, setCurrent] = createSignal(undefined)
    return (
      <div style={{ width: "280px" }}>
        <Field>
          <Field.Label tooltip="Choose one of the available options.">Fruit</Field.Label>
          <Field.Prefix>Optional helper</Field.Prefix>
          <Select
            placeholder={args.placeholder}
            invalid={args.invalid}
            disabled={args.disabled}
            options={fruits}
            current={current()}
            onSelect={(v) => setCurrent(v === null ? undefined : v)}
          />
          <Field.Suffix>After selection</Field.Suffix>
        </Field>
      </div>
    )
  },
}
