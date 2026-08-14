import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
import type { FormWithLocation } from "../../../context/data"
import { FORM_MODE, FormPrompt } from "../../../routes/session/form"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const compactOptions = [
  { value: "tests", label: "Tests", description: "Add or update automated coverage" },
  { value: "docs", label: "Documentation", description: "Update public and internal guidance" },
  { value: "telemetry", label: "Telemetry", description: "Add traces and operational signals" },
]

const extraOptions = [
  { value: "migration", label: "Migration", description: "Include a rollout or migration path" },
  { value: "benchmark", label: "Benchmark", description: "Measure performance before and after" },
  { value: "screenshots", label: "Screenshots", description: "Capture the changed interface" },
  { value: "followup", label: "Follow-up issue", description: "Record work that remains out of scope" },
]

function QuestionFormStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [custom, setCustom] = createSignal(true)
  const [multiselect, setMultiselect] = createSignal(true)
  const [multiple, setMultiple] = createSignal(true)
  const [dense, setDense] = createSignal(false)
  const [descriptions, setDescriptions] = createSignal(true)
  const [defaults, setDefaults] = createSignal(false)
  const [event, setEvent] = createSignal("Use the production form below; story submissions stay local")

  const form = createMemo(() => {
    const options = (dense() ? [...compactOptions, ...extraOptions] : compactOptions).map((option) => ({
      ...option,
      description: descriptions() ? option.description : undefined,
    }))
    return {
      id: "frm_story_question",
      sessionID: "ses_story_question",
      title: "Implementation checklist",
      metadata: { message: "What should be included in this change?" },
      fields: [
        multiselect()
          ? {
              key: "include",
              title: "Include",
              description: "Select every deliverable that applies.",
              type: "multiselect",
              options,
              custom: custom(),
              minItems: 1,
              default: defaults() ? ["tests", "docs"] : undefined,
            }
          : {
              key: "include",
              title: "Include",
              description: "Select the primary deliverable.",
              type: "string",
              options,
              custom: custom(),
              default: defaults() ? "tests" : undefined,
            },
        ...(multiple()
          ? [
              {
                key: "priority",
                title: "Priority",
                description: "How urgently should we ship it?",
                type: "string" as const,
                options: [
                  { value: "now", label: "Now", description: "Block other work and ship immediately" },
                  { value: "next", label: "Next", description: "Take it in the next focused pass" },
                  { value: "later", label: "Later", description: "Keep it visible without blocking" },
                ],
                custom: true,
              },
            ]
          : []),
      ],
    } satisfies FormWithLocation
  })

  const reset = () => {
    setCustom(true)
    setMultiselect(true)
    setMultiple(true)
    setDense(false)
    setDescriptions(true)
    setDefaults(false)
    setEvent("Reset to the reported multi-field checklist case")
  }

  props.context.keymap.layer(() => ({
    mode: FORM_MODE,
    commands: [
      {
        bind: "f2,ctrl+1",
        title: "Toggle custom answer",
        group: "Storybook",
        run: () => setCustom((value) => !value),
      },
      {
        bind: "f3,ctrl+2",
        title: "Toggle multiselect",
        group: "Storybook",
        run: () => setMultiselect((value) => !value),
      },
      {
        bind: "f4,ctrl+3",
        title: "Toggle field count",
        group: "Storybook",
        run: () => setMultiple((value) => !value),
      },
      {
        bind: "f5,ctrl+4",
        title: "Toggle option density",
        group: "Storybook",
        run: () => setDense((value) => !value),
      },
      {
        bind: "f6,ctrl+5",
        title: "Toggle descriptions",
        group: "Storybook",
        run: () => setDescriptions((value) => !value),
      },
      {
        bind: "f7,ctrl+6",
        title: "Toggle defaults",
        group: "Storybook",
        run: () => setDefaults((value) => !value),
      },
      { bind: "f8,ctrl+7", title: "Reset form story", group: "Storybook", run: reset },
    ],
  }))

  const settings = () =>
    [
      custom() ? "custom on" : "custom off",
      multiselect() ? "multi-select" : "single-select",
      multiple() ? "2 fields" : "1 field",
      dense() ? "7 options" : "3 options",
      descriptions() ? "descriptions on" : "descriptions off",
      defaults() ? "defaults on" : "defaults off",
    ].join("  ·  ")

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.default}
    >
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
        <text fg={theme.text.default}>Question form workbench</text>
        <text fg={theme.text.subdued}>{settings()}</text>
      </box>
      <box flexGrow={1} paddingLeft={1} paddingRight={1} justifyContent="flex-end">
        <Show when={form()} keyed>
          {(fixture) => (
            <FormPrompt
              form={fixture}
              onReply={(answer) => {
                setEvent(`Submitted ${JSON.stringify(answer)}`)
              }}
              onCancel={() => props.context.ui.router.navigate({ type: "plugin", name: "storybook" })}
            />
          )}
        </Show>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / question form"
        message={event()}
        controls={[
          { shortcut: "^1", label: "custom" },
          { shortcut: "^2", label: "select mode" },
          { shortcut: "^3", label: "fields" },
          { shortcut: "^4", label: "options" },
          { shortcut: "^5", label: "details" },
          { shortcut: "^6", label: "defaults" },
          { shortcut: "^7", label: "reset" },
        ]}
      />
    </box>
  )
}

export const questionFormStory: Story = {
  id: "question-form",
  title: "Question form",
  render: (context) => <QuestionFormStory context={context} />,
}
