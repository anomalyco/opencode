import { Button } from "@opencode/ui/button"
import { DockPrompt } from "./dock-prompt"

export default {
  title: "OpenCode/Requests/Prompt frame",
  id: "components-dock-prompt",
  component: DockPrompt,
  parameters: {
    docs: {
      description: {
        component:
          "The shared production frame for active questions and permission requests. Complete interactive examples live under Session/Complete workspace.",
      },
    },
  },
}

export const Question = {
  render: () => (
    <DockPrompt
      kind="question"
      header={
        <>
          <div data-slot="question-header-top">
            <div data-slot="question-header-title">Question</div>
          </div>
          <div data-slot="question-details">
            <div data-slot="question-text">Which Session layout should I implement?</div>
            <div data-slot="question-hint">Select one answer</div>
          </div>
        </>
      }
      footer={
        <>
          <Button size="large" variant="ghost">
            Dismiss
          </Button>
          <Button size="large" variant="submit">
            Submit
          </Button>
        </>
      }
    >
      <div data-slot="question-options" />
    </DockPrompt>
  ),
}

export const Permission = {
  render: () => (
    <DockPrompt
      kind="permission"
      header={<div class="text-13-medium text-text-strong">Permission required</div>}
      footer={
        <>
          <Button size="normal" variant="ghost">
            Deny
          </Button>
          <Button size="normal" variant="contrast">
            Allow once
          </Button>
        </>
      }
    >
      <code class="text-12-regular text-text-base">npm publish --tag canary</code>
    </DockPrompt>
  ),
}
