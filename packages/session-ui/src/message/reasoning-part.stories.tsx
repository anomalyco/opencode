import { AssistantReasoningContent } from "./message-content"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_TIME } from "../storybook/current-session-fixtures"

export default {
  title: "OpenCode/Conversation/Reasoning part",
  id: "current-reasoning-part",
}

const text = [
  "Opening paragraph: the reasoning text scrolls under the header.",
  ...Array.from({ length: 39 }, (_, index) => `Paragraph ${index + 2}: the reasoning text scrolls under the header.`),
].join("\n\n")

export const StickyHeader = {
  args: { height: 640 },
  argTypes: { height: { control: { type: "range", min: 240, max: 1200, step: 20 } } },
  render: (args: { height: number }) => (
    <section
      data-story="sticky-reasoning-scroll"
      class="relative w-full max-w-[720px] overflow-y-auto bg-v2-background-bg-base"
      style={{ height: `${args.height}px`, "--sticky-accordion-top": "48px" }}
    >
      <div class="sticky top-0 z-30 h-12 w-full bg-v2-background-bg-base" />
      <div class="px-6" style={{ "padding-bottom": `${args.height}px` }}>
        <CurrentSessionProviders
          document={{ sessionID: CURRENT_SESSION_ID, messages: [], status: { type: "idle" }, diffs: [] }}
        >
          <AssistantReasoningContent
            id="reasoning_sticky"
            content={{ type: "reasoning", text, time: { created: STORY_TIME, completed: STORY_TIME + 7000 } }}
            streaming={false}
            defaultOpen
          />
        </CurrentSessionProviders>
      </div>
    </section>
  ),
}
