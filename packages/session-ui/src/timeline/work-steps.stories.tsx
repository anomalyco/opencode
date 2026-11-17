import { WorkStepsFixture } from "../../component-tests/work-steps.fixture"
import type { WorkStepView } from "./work-steps"

export default {
  title: "OpenCode/Conversation/Work steps",
  id: "work-steps-playground",
  parameters: {
    layout: "fullscreen",
  },
}

export const Playground = {
  args: {
    timeline: "current",
    view: "standard",
  },
  render: (args: { timeline: "current" | "next"; view: WorkStepView }) => {
    return (
      <section class="mx-auto w-full max-w-[760px] p-6">
        <WorkStepsFixture
          timeline={args.timeline}
          workSteps={{
            view: args.view,
            collapseTiming: "completion",
            foldedReplies: "final",
          }}
          showControls
        />
      </section>
    )
  },
}
