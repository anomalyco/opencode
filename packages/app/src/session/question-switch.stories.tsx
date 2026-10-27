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

// A pick-any question with more answers than the dock has room for, then a short one.
export const LongList = {
  render: () => (
    <SessionPreview
      title="Polish the docs site"
      description="opencode · docs"
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          fields: [
            {
              key: "details",
              type: "multiselect",
              title: "Details",
              description: "Which should the builder add next? Pick any.",
              options: [
                {
                  value: "typography",
                  label: "All typography (Recommended)",
                  description:
                    "Hanging punctuation, tabular figures, typesetting fixes, one label style, accent selection",
                },
                { value: "links", label: "Heading links", description: "Hover shows #, click copies the section link" },
                {
                  value: "contents",
                  label: "Sticky contents list",
                  description: "Section list in the margin on wide screens, highlights where you are",
                },
                { value: "sidenotes", label: "Sidenotes", description: "Margin notes on desktop, inline on phone" },
                { value: "glossary", label: "Glossary terms", description: "Dotted underline, definition on hover" },
                { value: "fade", label: "Scroll fade", description: "Fade the edge of anything that scrolls sideways" },
                { value: "code", label: "Highlighted code lines", description: "Tint the lines that matter" },
                { value: "verdict", label: "Verdict line", description: "Answer or decision first, in the header" },
                {
                  value: "checked",
                  label: "Checked / not checked",
                  description: "Marker for verified vs unverified claims",
                },
                {
                  value: "diagram",
                  label: "Diagram interaction",
                  description: "Hover highlights connections, click enlarges",
                },
                { value: "footer", label: "Footer", description: "Source path to copy, plus the date it was made" },
              ],
            },
            {
              key: "ship",
              type: "string",
              title: "Ship",
              description: "Ship them in one pull request?",
              options: [
                { value: "one", label: "One pull request" },
                { value: "split", label: "One per detail" },
              ],
            },
          ],
        },
      }}
    />
  ),
}
