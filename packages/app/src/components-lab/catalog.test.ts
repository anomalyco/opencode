import { describe, expect, test } from "bun:test"
import { choice, knob, text, toggle } from "knobs"
import { knobArgs, labEntry, labFields, stateArgs } from "./catalog"

const source = `
export default { title: "Lab/Docks" }
export const Empty = {}
export const QueueThree = { name: "Queue 3", args: { queued: 3 } }
export const Answered = { args: { queued: 2, question: false } }
`

const module = {
  default: {
    title: "Lab/Docks",
    args: { queued: 0, question: false, size: "normal", label: "Send" },
    argTypes: {
      size: { control: "select", options: ["small", "normal"] },
      queued: { control: { type: "range", max: 6 } },
    },
  },
  Answered: { args: { queued: 2, question: false } },
  Empty: {},
  QueueThree: { name: "Queue 3", args: { queued: 3 } },
}

describe("labEntry", () => {
  test("keeps the states in source order, each over the meta's args", () => {
    const entry = labEntry("docks.stories.tsx", module, source)

    expect(entry.states.map((state) => state.name)).toEqual(["Empty", "Queue 3", "Answered"])
    expect(stateArgs(entry, 1)).toEqual({ queued: 3, question: false, size: "normal", label: "Send" })
  })
})

describe("labFields", () => {
  test("types each arg by its argType, else by its value", () => {
    const entry = labEntry("docks.stories.tsx", module, source)
    const fields = labFields(entry)

    expect(fields).toEqual({
      size: choice("normal", ["small", "normal"]),
      queued: knob(0, { min: 0, max: 6, step: 1 }),
      question: toggle(false, { random: true }),
      label: text("Send"),
    })
    expect(knobArgs(fields, stateArgs(entry, 1))).toEqual({ size: "normal", queued: 3, question: false, label: "Send" })
  })
})

test("starts each knob at the first state's value", () => {
  const entry = labEntry(
    "spinner.stories.tsx",
    { default: { args: { variant: "radar" } }, Today: { args: { variant: "today" } }, Radar: {} },
    "export const Today = {}\nexport const Radar = {}",
  )

  expect(labFields(entry).variant).toEqual(text("today"))
})
