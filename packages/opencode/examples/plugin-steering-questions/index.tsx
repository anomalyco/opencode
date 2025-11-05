/**
 * Steering Questions Plugin
 *
 * Allows the model to ask interactive steering questions within the message list.
 * Users can select from multiple choice options, provide text input, or both.
 *
 * This enables the model to gather specific requirements before proceeding with implementation.
 *
 * ## Usage in Message Stream
 *
 * The model can display a steering widget by including special text in its response:
 *
 * ```
 * <steering-question id="architecture-choice">
 * {
 *   "title": "Architecture Decisions",
 *   "description": "Help me understand your preferences:",
 *   "questions": [
 *     {
 *       "id": "framework",
 *       "label": "Frontend Framework",
 *       "type": "single-choice",
 *       "options": ["React", "Vue", "Svelte", "Vanilla JS"]
 *     },
 *     {
 *       "id": "styling",
 *       "label": "Styling Approach",
 *       "type": "multi-choice",
 *       "options": ["CSS Modules", "Tailwind", "Styled Components", "SCSS"]
 *     },
 *     {
 *       "id": "notes",
 *       "label": "Additional Requirements",
 *       "type": "text",
 *       "placeholder": "Any specific requirements or constraints?"
 *     }
 *   ]
 * }
 * </steering-question>
 * ```
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, For, Show, createMemo } from "../../src/plugin-ui"
import { TextAttributes } from "../../src/plugin-ui"

export interface SteeringQuestion {
  id: string
  label: string
  type: "single-choice" | "multi-choice" | "text"
  options?: string[]
  placeholder?: string
  required?: boolean
}

export interface SteeringQuestionConfig {
  title: string
  description?: string
  questions: SteeringQuestion[]
  submitLabel?: string
}

export interface SteeringAnswer {
  questionId: string
  answer: string | string[]
}

export const SteeringQuestionsPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      // This plugin doesn't register sidebar widgets, it embeds in message list
      output.messageWidgets = [
        {
          id: "steering-question",
          pattern: /<steering-question[^>]*>([\s\S]*?)<\/steering-question>/g,
          systemPrompt: `# Steering Questions

You can ask the user interactive questions to gather requirements before implementing features.

## Usage

Include a <steering-question> widget in your response:

\`\`\`
<steering-question id="unique-id">
{
  "title": "Title of the question set",
  "description": "Optional description",
  "questions": [
    {
      "id": "question-id",
      "label": "Question Label",
      "type": "single-choice",
      "options": ["Option 1", "Option 2", "Option 3"],
      "required": true
    },
    {
      "id": "another-question",
      "label": "Another Question",
      "type": "multi-choice",
      "options": ["Feature A", "Feature B", "Feature C"],
      "required": false
    },
    {
      "id": "notes",
      "label": "Additional Notes",
      "type": "text",
      "placeholder": "Any specific requirements?",
      "required": false
    }
  ],
  "submitLabel": "Continue"
}
</steering-question>
\`\`\`

## Question Types

- **single-choice**: Radio buttons (user picks one)
- **multi-choice**: Checkboxes (user picks multiple)
- **text**: Text input field

## When to Use

Use steering questions when you need to:
- Gather architecture decisions before implementation
- Clarify ambiguous requirements
- Offer configuration choices
- Get user preferences for styling, frameworks, etc.

## Best Practices

1. Group related questions together
2. Keep option lists concise (3-6 options ideal)
3. Use clear, specific labels
4. Mark critical decisions as required
5. Provide helpful descriptions
6. Use meaningful question IDs

## Example: Framework Selection

\`\`\`
Before I create the project, let me understand your preferences:

<steering-question id="project-setup">
{
  "title": "Project Configuration",
  "description": "Choose your technology stack:",
  "questions": [
    {
      "id": "framework",
      "label": "Frontend Framework",
      "type": "single-choice",
      "options": ["React", "Vue", "Svelte", "Vanilla JS"],
      "required": true
    },
    {
      "id": "styling",
      "label": "Styling Approach",
      "type": "multi-choice",
      "options": ["Tailwind CSS", "CSS Modules", "Styled Components"],
      "required": false
    }
  ]
}
</steering-question>

Once you submit your choices, I'll set up the project accordingly.
\`\`\`

The user will see an interactive widget with clickable options. After they submit, their answers will be sent back to you as a message, and you can proceed with implementation based on their choices.`,
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      const { componentId, context } = input

      if (componentId === "steering-question") {
        const { config, onSubmit, theme } = context

        const SteeringQuestionWidget = () => {
          const questionConfig: SteeringQuestionConfig = config
          const [answers, setAnswers] = createSignal<Record<string, string | string[]>>({})
          const [submitted, setSubmitted] = createSignal(false)
          const [hoveredSubmit, setHoveredSubmit] = createSignal(false)

          // Defensive check for malformed config
          if (
            !questionConfig ||
            !questionConfig.questions ||
            !Array.isArray(questionConfig.questions)
          ) {
            return (
              <box
                flexDirection="column"
                gap={1}
                border={["left"]}
                paddingTop={1}
                paddingBottom={1}
                paddingLeft={2}
                marginTop={1}
                backgroundColor={theme?.backgroundPanel || "#1a1a1a"}
                borderColor={theme?.error || "#ff0000"}
                flexShrink={0}
              >
                <text attributes={TextAttributes.BOLD} fg={theme?.error || "#ff0000"}>
                  ✗ Invalid Question Configuration
                </text>
                <text fg={theme?.textMuted || "#808080"}>
                  The steering question widget requires a valid config with a 'questions' array.
                </text>
              </box>
            )
          }

          const allRequiredAnswered = createMemo(() => {
            const required = questionConfig.questions.filter((q) => q.required !== false)
            return required.every((q) => {
              const answer = answers()[q.id]
              if (!answer) return false
              if (typeof answer === "string") return answer.trim().length > 0
              if (Array.isArray(answer)) return answer.length > 0
              return false
            })
          })

          const handleSingleChoice = (questionId: string, option: string) => {
            setAnswers((prev) => ({
              ...prev,
              [questionId]: prev[questionId] === option ? "" : option,
            }))
          }

          const handleMultiChoice = (questionId: string, option: string) => {
            setAnswers((prev) => {
              const current = (prev[questionId] as string[]) || []
              const updated = current.includes(option)
                ? current.filter((o) => o !== option)
                : [...current, option]
              return { ...prev, [questionId]: updated }
            })
          }

          // Text input handling would be implemented via dialog or prompt integration
          // const handleTextChange = (questionId: string, value: string) => {
          //   setAnswers((prev) => ({
          //     ...prev,
          //     [questionId]: value,
          //   }))
          // }

          const handleSubmit = () => {
            if (!allRequiredAnswered()) return
            setSubmitted(true)
            const formattedAnswers: SteeringAnswer[] = questionConfig.questions
              .map((q) => ({
                questionId: q.id,
                answer: answers()[q.id] || (q.type === "multi-choice" ? [] : ""),
              }))
              .filter((a) => {
                if (typeof a.answer === "string") return a.answer.length > 0
                if (Array.isArray(a.answer)) return a.answer.length > 0
                return false
              })

            if (onSubmit) {
              onSubmit(formattedAnswers)
            }
          }

          return (
            <box
              flexDirection="column"
              gap={1}
              border={["left"]}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              marginTop={1}
              backgroundColor={theme?.backgroundPanel || "#1a1a1a"}
              borderColor={submitted() ? theme?.success || "#00ff00" : theme?.accent || "#0088ff"}
              flexShrink={0}
            >
              {/* Header */}
              <text attributes={TextAttributes.BOLD} fg={theme?.text || "#ffffff"}>
                {questionConfig.title}
              </text>

              <Show when={questionConfig.description}>
                <text fg={theme?.textMuted || "#808080"}>{questionConfig.description}</text>
              </Show>

              <Show when={!submitted()}>
                {/* Questions */}
                <box flexDirection="column" gap={1} marginTop={1}>
                  <For each={questionConfig.questions}>
                    {(question) => (
                      <box flexDirection="column" gap={0}>
                        <text fg={theme?.text || "#ffffff"}>
                          {question.label}
                          <Show when={question.required !== false}>
                            <span style={{ fg: theme?.error || "#ff0000" }}> *</span>
                          </Show>
                        </text>

                        {/* Single Choice */}
                        <Show when={question.type === "single-choice" && question.options}>
                          <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                            <For each={question.options}>
                              {(option) => {
                                const isSelected = createMemo(
                                  () => answers()[question.id] === option,
                                )
                                return (
                                  <text
                                    fg={
                                      isSelected()
                                        ? theme?.accent || "#0088ff"
                                        : theme?.textMuted || "#808080"
                                    }
                                    onMouseUp={() => handleSingleChoice(question.id, option)}
                                  >
                                    {isSelected() ? "◉" : "○"} {option}
                                  </text>
                                )
                              }}
                            </For>
                          </box>
                        </Show>

                        {/* Multi Choice */}
                        <Show when={question.type === "multi-choice" && question.options}>
                          <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                            <For each={question.options}>
                              {(option) => {
                                const isSelected = createMemo(() => {
                                  const current = answers()[question.id]
                                  return Array.isArray(current) && current.includes(option)
                                })
                                return (
                                  <text
                                    fg={
                                      isSelected()
                                        ? theme?.accent || "#0088ff"
                                        : theme?.textMuted || "#808080"
                                    }
                                    onMouseUp={() => handleMultiChoice(question.id, option)}
                                  >
                                    {isSelected() ? "☑" : "☐"} {option}
                                  </text>
                                )
                              }}
                            </For>
                          </box>
                        </Show>

                        {/* Text Input (display value, note: actual input would need prompt integration) */}
                        <Show when={question.type === "text"}>
                          <box marginTop={0}>
                            <text fg={theme?.textMuted || "#808080"}>
                              {answers()[question.id]
                                ? `> ${answers()[question.id]}`
                                : `${question.placeholder || "Click to enter text..."}`}
                            </text>
                            {/* Note: In real implementation, clicking would trigger a dialog or prompt */}
                          </box>
                        </Show>
                      </box>
                    )}
                  </For>
                </box>

                {/* Submit Button */}
                <box marginTop={1}>
                  <text
                    fg={
                      allRequiredAnswered()
                        ? hoveredSubmit()
                          ? theme?.success || "#00ff00"
                          : theme?.accent || "#0088ff"
                        : theme?.textMuted || "#808080"
                    }
                    attributes={allRequiredAnswered() ? TextAttributes.BOLD : undefined}
                    onMouseOver={() => setHoveredSubmit(true)}
                    onMouseOut={() => setHoveredSubmit(false)}
                    onMouseUp={handleSubmit}
                  >
                    {allRequiredAnswered()
                      ? `▶ ${questionConfig.submitLabel || "Submit Answers"}`
                      : `○ ${questionConfig.submitLabel || "Submit Answers"} (complete required fields)`}
                  </text>
                </box>
              </Show>

              {/* Submitted State */}
              <Show when={submitted()}>
                <box flexDirection="column" gap={0} marginTop={1}>
                  <text fg={theme?.success || "#00ff00"} attributes={TextAttributes.BOLD}>
                    ✓ Answers Submitted
                  </text>
                  <For each={questionConfig.questions}>
                    {(question) => {
                      const answer = answers()[question.id]
                      if (!answer) return null
                      return (
                        <box flexDirection="row" gap={1} marginTop={0}>
                          <text fg={theme?.textMuted || "#808080"}>{question.label}:</text>
                          <text fg={theme?.text || "#ffffff"}>
                            {Array.isArray(answer) ? answer.join(", ") : answer}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </Show>
            </box>
          )
        }

        output.component = SteeringQuestionWidget
        output.type = "component"
      }
    },
  }
}

export default SteeringQuestionsPlugin
