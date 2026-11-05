// @ts-nocheck
import { createSignal } from "solid-js"
import { Field } from "@opencode/ui/field"
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
- \`selectOnNavigate\`: arrow keys and typeahead select the option they move to while the menu stays open; hover only highlights.
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

export const SelectOnNavigate = {
  render: () => {
    const [current, setCurrent] = createSignal("Banana")

    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <Select options={fruits} current={current()} onSelect={(v) => v !== null && setCurrent(v)} selectOnNavigate />
        <span data-testid="select-on-navigate-current">Selected: {current()}</span>
      </div>
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

export const Appearances = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Select appearance="small" placeholder="Small (24px)" options={fruits} onSelect={() => {}} />
      <Select appearance="base" placeholder="Base (28px)" options={fruits} current="Banana" onSelect={() => {}} />
      <Select appearance="large" placeholder="Large (32px)" options={fruits} current="Cherry" onSelect={() => {}} />
      <Select placeholder="Inline (default)" options={fruits} current="Date" onSelect={() => {}} />
    </div>
  ),
}

export const Surfaces = {
  render: () => (
    <div style={{ display: "grid", gap: "20px", width: "280px" }}>
      <Select appearance="base" placeholder="Base (default)" options={fruits} onSelect={() => {}} />
      <Select appearance="base" surface="layer-1" placeholder="Layer 1" options={fruits} onSelect={() => {}} />
      <Select appearance="base" surface="invisible" placeholder="Invisible" options={fruits} onSelect={() => {}} />
      <Select
        appearance="base"
        surface="invisible"
        placeholder="Invisible, invalid"
        options={fruits}
        invalid
        onSelect={() => {}}
      />
      <Select
        appearance="base"
        surface="invisible"
        placeholder="Invisible, disabled"
        options={fruits}
        disabled
        onSelect={() => {}}
      />
    </div>
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
