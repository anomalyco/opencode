import { describe, expect, test } from "bun:test"
import type { FormField } from "@opencode/client/promise"
import {
  createProviderFormState,
  FORM_BROWSER_OPEN_TIMEOUT_MS,
  selectProviderFormView,
  transitionProviderForm,
  type ProviderActiveForm,
  type ProviderFormEvent,
  type ProviderFormState,
  type ProviderFormTransition,
} from "./form-machine"

function active(state: ProviderFormState) {
  if (state.status !== "active") throw new Error(`expected an active form, got ${state.status}`)

  return state
}

function replay(fields: FormField[], events: ProviderFormEvent[]) {
  return events.reduce<ProviderFormTransition>((result, event) => transitionProviderForm(active(result.state), event), {
    state: createProviderFormState(fields),
    effects: [],
  })
}

const view = (state: ProviderFormState) => selectProviderFormView(active(state))

const external = (key: string): FormField => ({ key, type: "external", url: `https://setup.example/${key}` })

describe("provider form machine", () => {
  // The driver reports a launch that returns false, throws, or does not answer in time as not opened.
  test("a browser that fails to open still lets the user finish with the link shown", () => {
    const opening = replay([external("login")], [{ type: "external.open" }])

    expect(opening.effects).toEqual([
      { type: "open.browser", attempt: 1, url: "https://setup.example/login", timeoutMs: FORM_BROWSER_OPEN_TIMEOUT_MS },
    ])
    expect(view(opening.state)).toMatchObject({ kind: "external", opening: true, canFinish: false })

    const failed = transitionProviderForm(active(opening.state), { type: "external.opened", attempt: 1, opened: false })

    expect(view(failed.state)).toMatchObject({ browserFailed: true, canFinish: true, opening: false })
    expect(transitionProviderForm(active(failed.state), { type: "step.submitted" }).state).toEqual({
      status: "completed",
      answer: { login: true },
    })
  })

  test("finishing is blocked until the first open answers, and stays open while reopening", () => {
    const unopened = createProviderFormState([external("login")])

    expect(transitionProviderForm(active(unopened), { type: "step.submitted" }).state).toBe(unopened)

    const opened = replay(
      [external("login")],
      [{ type: "external.open" }, { type: "external.opened", attempt: 1, opened: true }, { type: "external.open" }],
    )

    expect(view(opened.state)).toMatchObject({ opening: true, canFinish: true })
    expect(transitionProviderForm(active(opened.state), { type: "external.open" }).state).toBe(opened.state)
  })

  test("a late open from an earlier step does not mark the next step opened", () => {
    const second = replay(
      [external("first"), external("second")],
      [
        { type: "external.open" },
        { type: "external.opened", attempt: 1, opened: false },
        { type: "external.open" },
        { type: "step.submitted" },
      ],
    )

    expect(view(second.state)).toMatchObject({ key: "1:second", canFinish: false })

    const late = transitionProviderForm(active(second.state), { type: "external.opened", attempt: 2, opened: true })

    expect(late.state).toBe(second.state)

    const opening = transitionProviderForm(active(second.state), { type: "external.open" })

    expect(
      transitionProviderForm(active(opening.state), { type: "external.opened", attempt: 2, opened: true }).state,
    ).toBe(opening.state)
  })

  test("a hidden default whose condition depends on an earlier answer applies once that answer matches", () => {
    const fields: FormField[] = [
      {
        key: "region",
        type: "string",
        options: [
          { value: "eu", label: "EU" },
          { value: "us", label: "US" },
        ],
      },
      {
        key: "endpoint",
        type: "string",
        hidden: true,
        default: "eu.example",
        when: [{ key: "region", op: "eq", value: "eu" }],
      },
      { key: "tenant", type: "string", when: [{ key: "endpoint", op: "eq", value: "eu.example" }] },
    ]

    const eu = replay(fields, [{ type: "choice.selected", value: "eu" }, { type: "step.submitted" }])

    expect(view(eu.state)).toMatchObject({ kind: "text", key: "2:tenant" })
    expect(active(eu.state).answer).toEqual({ region: "eu", endpoint: "eu.example" })

    const us = replay(fields, [{ type: "choice.selected", value: "us" }, { type: "step.submitted" }])

    expect(us.state).toEqual({ status: "completed", answer: { region: "us" } })
  })

  test("a form with nothing to ask answers itself with the hidden defaults", () => {
    expect(
      createProviderFormState([
        { key: "mode", type: "string", hidden: true, default: "fast" },
        { key: "extra", type: "string", when: [{ key: "mode", op: "eq", value: "slow" }] },
      ]),
    ).toEqual({ status: "completed", answer: { mode: "fast" } })
  })

  test("custom is only a choice on a string field that allows it, and its text survives a preset pick", () => {
    const flag = createProviderFormState([{ key: "beta", type: "boolean" }])

    expect(transitionProviderForm(active(flag), { type: "choice.selected", value: "custom" }).state).toBe(flag)

    const fields: FormField[] = [{ key: "model", type: "string", custom: true, options: [{ value: "a", label: "A" }] }]

    const typed = replay(fields, [
      { type: "choice.selected", value: "custom" },
      { type: "custom.text.changed", value: "my-model" },
      { type: "choice.selected", value: "a" },
      { type: "choice.selected", value: "custom" },
    ])

    expect(view(typed.state)).toMatchObject({ selected: "custom", customText: "my-model", canContinue: true })
    expect(transitionProviderForm(active(typed.state), { type: "step.submitted" }).state).toEqual({
      status: "completed",
      answer: { model: "my-model" },
    })
  })

  test("text and number steps validate before they answer", () => {
    const fields: FormField[] = [{ key: "port", type: "integer", required: true }]
    const empty = replay(fields, [{ type: "step.submitted" }])

    expect(view(empty.state)).toMatchObject({ error: "required" })

    const fraction = replay(fields, [{ type: "text.changed", value: "1.5" }, { type: "step.submitted" }])

    expect(view(fraction.state)).toMatchObject({ error: "number" })
    expect(
      view(transitionProviderForm(active(fraction.state), { type: "text.changed", value: "8" }).state),
    ).toMatchObject({ error: undefined })
    expect(replay(fields, [{ type: "text.changed", value: " 8080 " }, { type: "step.submitted" }]).state).toEqual({
      status: "completed",
      answer: { port: 8080 },
    })
  })

  test("a multiselect answers only within its limits", () => {
    const fields: FormField[] = [
      {
        key: "scopes",
        type: "multiselect",
        maxItems: 1,
        custom: true,
        options: [{ value: "read", label: "Read" }],
      },
    ]

    const two = replay(fields, [
      { type: "option.toggled", value: "read", checked: true },
      { type: "custom.text.changed", value: "write" },
      { type: "custom.item.added" },
    ])

    expect(view(two.state)).toMatchObject({ picked: ["read", "write"], issue: "max-items", canContinue: false })
    expect(transitionProviderForm(active(two.state), { type: "step.submitted" }).state).toBe(two.state)

    const one = transitionProviderForm(active(two.state), { type: "option.toggled", value: "read", checked: false })

    expect(transitionProviderForm(active(one.state), { type: "step.submitted" }).state).toEqual({
      status: "completed",
      answer: { scopes: ["write"] },
    })
  })

  test("an inapplicable event returns the same state", () => {
    const form: ProviderActiveForm = active(createProviderFormState([{ key: "name", type: "string" }]))

    expect(transitionProviderForm(form, { type: "external.open" }).state).toBe(form)
    expect(transitionProviderForm(form, { type: "text.changed", value: "" }).state).toBe(form)
  })
})
