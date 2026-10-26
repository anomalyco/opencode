import { activeQuestionRequest, questionPendingDocument } from "@opencode/session-ui/storybook"
import { SessionPreview } from "./story-model"

export default {
  title: "OpenCode/Session/Question switch",
  id: "session-question-switch",
  component: SessionPreview,
  parameters: {
    layout: "fullscreen",
    // The components lab shows these Knobs and their replay buttons in its inspector.
    motion: ["Question"],
    docs: {
      description: {
        component:
          "A pending question dock with five questions of different heights. Step through them with ← and →, or the Replay buttons under Knobs → Timeline → Question. Its motion is off until Question dock motion is turned on there.",
      },
    },
  },
}

// Several questions of different lengths and kinds in a row, to step through with ← and →.
export const QuestionSeries = {
  render: () => (
    <SessionPreview
      title="Decide what to build next"
      description="opencode · modular-session-ui"
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          fields: [
            activeQuestionRequest.fields[0],
            {
              key: "eval",
              type: "string",
              title: "Eval",
              description: "Build the skill-trigger eval: the full list against a budgeted one, on real prompts?",
              options: [
                {
                  value: "build",
                  label: "Build the eval (Recommended)",
                  description: "Measurement only. No change to the product.",
                },
                {
                  value: "trim",
                  label: "Also trim our skills",
                  description: "Eval, plus shorten skill descriptions over 1,024 characters.",
                },
                { value: "later", label: "Not now", description: "Park it." },
              ],
              custom: true,
            },
            {
              ...activeQuestionRequest.fields[1],
              options: [...activeQuestionRequest.fields[1].options, { value: "diagnostics", label: "Diagnostics" }],
            },
            {
              key: "backup",
              type: "string",
              title: "Backup",
              description:
                "motion-lint has five unpushed commits on main, plus other branches and uncommitted edits. Push it to the private repo as a backup?",
              options: [
                {
                  value: "push",
                  label: "Push it (Recommended)",
                  description: "Commit the work in progress to a branch and push everything.",
                },
                { value: "local", label: "Leave local", description: "Don't push." },
              ],
              custom: true,
            },
            {
              key: "levers",
              type: "multiselect",
              title: "Levers",
              description: "Which levers should I build now?",
              options: [
                { value: "sweep", label: "Stale PR sweep" },
                { value: "diet", label: "Review diet" },
                { value: "ladder", label: "Resume ladder" },
                { value: "none", label: "None for now" },
              ],
            },
          ],
        },
      }}
    />
  ),
}
