import { markdown } from "@opencode-ai/ui/storybook/fixtures"
import { Markdown } from "./markdown"

export default {
  title: "OpenCode/Conversation/Markdown response",
  id: "components-markdown",
  component: Markdown,
  parameters: {
    docs: {
      description: {
        component:
          "Production assistant Markdown with headings, lists, links, inline code, and fenced code. The preview uses the same sanitizer, worker, and copy actions as a Session response.",
      },
    },
  },
}

export const CompleteResponse = {
  render: () => (
    <div class="mx-auto max-w-[760px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown text={markdown} />
    </div>
  ),
}

export const CompactResult = {
  render: () => (
    <div class="mx-auto max-w-[560px] rounded-lg border border-border-weak-base bg-background-base px-5 py-4">
      <Markdown
        text={"Updated the Session status and verified it.\n\n- **12 tests passed**\n- `bun typecheck` passed"}
      />
    </div>
  ),
}
