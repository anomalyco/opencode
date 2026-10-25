// @ts-nocheck
import * as mod from "./dock-prompt"
import { create } from "@bolt-ai/ui/storybook/scaffold"

const docs = `### Overview
Docked prompt layout for questions and permission requests.

Use with form controls or confirmation buttons in the footer.

### API
- Required: \`kind\` (question | permission), \`header\`, \`children\`, \`footer\`.
- Optional: \`ref\` for measuring or focus management.

### Variants and states
- Question and permission layouts (data attributes).

### Behavior
- Pure layout component; behavior handled by parent.

### Accessibility
- Ensure header and footer content provide clear context and actions.

### Theming/tokens
- Uses \`data-component="dock-prompt"\` with kind data attribute.

`

const story = create({
  title: "UI/DockPrompt",
  mod,
  args: {
    kind: "question",
    header: "Header",
    children: "Prompt content",
    footer: "Footer",
  },
})

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
