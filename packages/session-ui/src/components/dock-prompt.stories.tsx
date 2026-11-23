import { Button } from "@opencode/ui/button"
import { DockPrompt } from "./dock-prompt"

export default {
  title: "OpenCode/Requests/Prompt frame",
  id: "components-dock-prompt",
  component: DockPrompt,
  args: { experimental: false },
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
  args: { prompt: "Which Session layout should I implement?", hint: "Select one answer" },
  render: (args: { experimental: boolean; prompt: string; hint: string }) => (
    <DockPrompt
      kind="question"
      variant={args.experimental ? "experimental" : undefined}
      header={
        <>
          <div data-slot="question-header-top">
            <div data-slot="question-header-title">Question</div>
          </div>
          <div data-slot="question-details">
            <div data-slot="question-text">{args.prompt}</div>
            <div data-slot="question-hint">{args.hint}</div>
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
  args: { command: "npm publish --tag canary" },
  render: (args: { experimental: boolean; command: string }) => (
    <DockPrompt
      kind="permission"
      variant={args.experimental ? "experimental" : undefined}
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
      <code class="text-12-regular text-text-base">{args.command}</code>
    </DockPrompt>
  ),
}
