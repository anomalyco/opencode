/** @jsxImportSource @opentui/solid */
// P-COMP fixtures for the form prompt (packages/tui/src/routes/session/form.tsx), one per field kind plus the
// review: crates/tui/tests/form_parity.rs. The Rust prompt sits in the session route of a 100x30 app, inside two
// columns of padding on each side, so the TS prompt renders alone at 96x30.
import type { FormWithLocation } from "../../../tui/src/context/data"
import { FormPrompt } from "../../../tui/src/routes/session/form"
import { renderComponent } from "../lib/component"

const form = (fields: FormWithLocation["fields"]): FormWithLocation => ({
  id: "frm_1",
  sessionID: "ses_root",
  title: "Deploy settings",
  metadata: { message: "Pick how to deploy." },
  fields,
})

const kinds: FormWithLocation["fields"] = [
  { key: "name", type: "string", title: "Name", required: true },
  { key: "count", type: "integer", title: "Replicas", minimum: 1, maximum: 5 },
  { key: "agree", type: "boolean", title: "Confirm", description: "Restart the service?" },
  {
    key: "targets",
    type: "multiselect",
    title: "Targets",
    custom: true,
    default: ["a"],
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", description: "The second region" },
    ],
  },
]

const base = { width: 96, height: 30, ready: (frame: string) => frame.includes("Deploy settings") }
// Answers the required name, then moves `count` tabs on.
const tabs =
  (count: number) => async (setup: Parameters<NonNullable<Parameters<typeof renderComponent>[0]["act"]>>[0]) => {
    await setup.mockInput.typeText("Ada")
    for (let index = 0; index < count; index++) setup.mockInput.pressTab()
  }

await renderComponent({
  ...base,
  fixture: "E.9b/choice",
  element: () => (
    <FormPrompt
      form={form([
        {
          key: "target",
          type: "string",
          custom: true,
          options: [
            { value: "staging", label: "Staging" },
            { value: "production", label: "Production", description: "Live traffic" },
          ],
        },
      ])}
    />
  ),
  act: (setup) => setup.mockInput.pressArrow("down"),
})
await renderComponent({ ...base, fixture: "E.9b/text", element: () => <FormPrompt form={form(kinds)} /> })
await renderComponent({
  ...base,
  fixture: "E.9b/integer",
  element: () => <FormPrompt form={form(kinds)} />,
  act: tabs(1),
})
await renderComponent({
  ...base,
  fixture: "E.9b/boolean",
  element: () => <FormPrompt form={form(kinds)} />,
  act: tabs(2),
})
await renderComponent({
  ...base,
  fixture: "E.9b/multiselect",
  element: () => <FormPrompt form={form(kinds)} />,
  act: tabs(3),
})
await renderComponent({
  ...base,
  fixture: "E.9b/review",
  element: () => <FormPrompt form={form(kinds)} />,
  act: tabs(4),
})
await renderComponent({
  ...base,
  fixture: "E.9b/external",
  element: () => (
    <FormPrompt
      form={form([
        {
          key: "authorization",
          type: "external",
          url: "https://example.com/authorize",
          title: "Authorize access",
          description: "Sign in to continue.",
        },
      ])}
    />
  ),
})
await renderComponent({
  ...base,
  fixture: "E.9b/progress",
  element: () => (
    <FormPrompt
      form={form(
        ["first", "second", "third", "fourth"].map((key) => ({
          key,
          type: "string" as const,
          title: `The ${key} question that is long`,
        })),
      )}
    />
  ),
})
