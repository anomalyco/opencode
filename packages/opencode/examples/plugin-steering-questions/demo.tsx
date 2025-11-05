/**
 * Demo Steering Questions Widget
 *
 * Simpler example showing the core concept with tabs
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, For, Show } from "../../src/plugin-ui"
import { TextAttributes } from "../../src/plugin-ui"

export const DemoSteeringPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      output.panels = [
        {
          id: "steering-demo",
          label: "Steering Q&A",
          area: "right",
          position: "top",
          collapsible: true,
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      const { componentId, context } = input

      if (componentId === "steering-demo") {
        const { theme } = context

        const SteeringDemo = () => {
          type TabId = "arch" | "style" | "testing" | "deployment"
          const [activeTab, setActiveTab] = createSignal<TabId>("arch")
          const [answers, setAnswers] = createSignal<Record<string, string | string[]>>({})
          const [submitted, setSubmitted] = createSignal(false)

          const tabs: Array<{ id: TabId; label: string }> = [
            { id: "arch", label: "Architecture" },
            { id: "style", label: "Styling" },
            { id: "testing", label: "Testing" },
            { id: "deployment", label: "Deployment" },
          ]

          const questions: Record<
            TabId,
            Array<{
              id: string
              label: string
              type: "single" | "multi"
              options: string[]
            }>
          > = {
            arch: [
              {
                id: "framework",
                label: "Framework",
                type: "single",
                options: ["React", "Vue", "Svelte", "Vanilla"],
              },
              {
                id: "state",
                label: "State Management",
                type: "single",
                options: ["Context", "Redux", "Zustand", "Jotai"],
              },
            ],
            style: [
              {
                id: "css",
                label: "CSS Approach",
                type: "multi",
                options: ["Tailwind", "CSS Modules", "Styled Components", "SCSS"],
              },
              {
                id: "theme",
                label: "Theme System",
                type: "single",
                options: ["Light/Dark", "Multiple Themes", "Custom", "None"],
              },
            ],
            testing: [
              {
                id: "unit",
                label: "Unit Testing",
                type: "single",
                options: ["Vitest", "Jest", "None"],
              },
              {
                id: "e2e",
                label: "E2E Testing",
                type: "single",
                options: ["Playwright", "Cypress", "None"],
              },
            ],
            deployment: [
              {
                id: "platform",
                label: "Platform",
                type: "single",
                options: ["Vercel", "Netlify", "AWS", "Docker"],
              },
              {
                id: "ci",
                label: "CI/CD",
                type: "multi",
                options: ["GitHub Actions", "GitLab CI", "CircleCI", "None"],
              },
            ],
          }

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

          const handleSubmit = () => {
            setSubmitted(true)
            console.log("Submitted answers:", answers())
          }

          const answerCount = () => Object.keys(answers()).filter((k) => answers()[k]).length

          return (
            <box flexDirection="column" gap={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.accent}>
                Project Configuration Questions
              </text>

              <Show when={!submitted()}>
                {/* Tab Navigation */}
                <box flexDirection="row" gap={2} marginTop={0}>
                  <For each={tabs}>
                    {(tab) => (
                      <text
                        fg={activeTab() === tab.id ? theme.accent : theme.textMuted}
                        attributes={activeTab() === tab.id ? TextAttributes.BOLD : undefined}
                        onMouseUp={() => setActiveTab(tab.id)}
                      >
                        {activeTab() === tab.id ? "●" : "○"} {tab.label}
                      </text>
                    )}
                  </For>
                </box>

                {/* Questions for Active Tab */}
                <box flexDirection="column" gap={1} marginTop={0}>
                  <For each={questions[activeTab()]}>
                    {(question) => (
                      <box flexDirection="column" gap={0}>
                        <text fg={theme.text}>{question.label}:</text>
                        <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                          <For each={question.options}>
                            {(option) => {
                              const isSelected = () => {
                                const answer = answers()[question.id]
                                if (question.type === "single") {
                                  return answer === option
                                }
                                return Array.isArray(answer) && answer.includes(option)
                              }

                              const icon = () => {
                                if (question.type === "single") {
                                  return isSelected() ? "◉" : "○"
                                }
                                return isSelected() ? "☑" : "☐"
                              }

                              return (
                                <text
                                  fg={isSelected() ? theme.accent : theme.textMuted}
                                  onMouseUp={() => {
                                    if (question.type === "single") {
                                      handleSingleChoice(question.id, option)
                                    } else {
                                      handleMultiChoice(question.id, option)
                                    }
                                  }}
                                >
                                  {icon()} {option}
                                </text>
                              )
                            }}
                          </For>
                        </box>
                      </box>
                    )}
                  </For>
                </box>

                {/* Submit Button */}
                <box marginTop={0}>
                  <text
                    fg={answerCount() > 0 ? theme.success : theme.textMuted}
                    attributes={answerCount() > 0 ? TextAttributes.BOLD : undefined}
                    onMouseUp={handleSubmit}
                  >
                    {answerCount() > 0
                      ? `▶ Submit Answers (${answerCount()} selected)`
                      : "○ Submit Answers (select at least one)"}
                  </text>
                </box>
              </Show>

              {/* Submitted State */}
              <Show when={submitted()}>
                <box flexDirection="column" gap={0}>
                  <text fg={theme.success} attributes={TextAttributes.BOLD}>
                    ✓ Configuration Submitted
                  </text>
                  <text fg={theme.textMuted}>Selected {answerCount()} options across all tabs</text>
                  <box flexDirection="column" gap={0} marginTop={0}>
                    <For each={Object.entries(answers())}>
                      {([key, value]) => {
                        if (!value) return null
                        const valueStr = Array.isArray(value) ? value.join(", ") : value
                        return (
                          <text fg={theme.text}>
                            <span style={{ fg: theme.textMuted }}>{key}:</span> {valueStr}
                          </text>
                        )
                      }}
                    </For>
                  </box>
                </box>
              </Show>
            </box>
          )
        }

        output.component = SteeringDemo
        output.type = "component"
      }
    },
  }
}

export default DemoSteeringPlugin
