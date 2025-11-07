import { createSignal, Show, onMount, type Component, For, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"
import { Plugin } from "@/plugin"
import { getCoreWidget } from "@/ui/renderers"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"

export interface PluginComponentProps {
  componentId: string
  context?: Record<string, any>
  fallback?: string
}

/**
 * Core built-in renderers for message widgets
 * Returns a Solid component function
 */
function getCoreRenderer(componentId: string, context: Record<string, any>): Component<any> | null {
  if (componentId === "steering-question") {
    return () => <SteeringQuestionWidget config={context.config} onSubmit={context.onSubmit} />
  }
  if (componentId === "form") {
    return () => <FormWidget config={context.config} onSubmit={context.onSubmit} />
  }
  return null
}

/**
 * Built-in Steering Questions Widget Component
 */
function SteeringQuestionWidget(props: { config: any; onSubmit?: (answers: any) => void }) {
  const { theme } = useTheme()
  const [answers, setAnswers] = createSignal<Record<string, any>>({})
  const [submitted, setSubmitted] = createSignal(false)
  const [hoveredSubmit, setHoveredSubmit] = createSignal(false)

  const questionConfig = createMemo(() => {
    const config = props.config || {}
    return {
      title: config.title || "Question",
      description: config.description || "",
      questions: Array.isArray(config.questions) ? config.questions : [],
      submitLabel: config.submitLabel || "Submit Answers",
    }
  })

  const allRequiredAnswered = createMemo(() => {
    const questions = questionConfig().questions
    if (!Array.isArray(questions)) return false
    const required = questions.filter((q: any) => q.required !== false)
    return required.every((q: any) => {
      const answer = answers()[q.id]
      if (typeof answer === "string") return answer.length > 0
      if (Array.isArray(answer)) return answer.length > 0
      return false
    })
  })

  const handleSingleChoice = (questionId: string, option: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: option }))
  }

  const handleMultiChoice = (questionId: string, option: string) => {
    setAnswers((prev) => {
      const current = prev[questionId] || []
      const updated = current.includes(option)
        ? current.filter((o: string) => o !== option)
        : [...current, option]
      return { ...prev, [questionId]: updated }
    })
  }

  const handleSubmit = () => {
    if (!allRequiredAnswered()) return
    setSubmitted(true)

    const questions = questionConfig().questions
    if (!Array.isArray(questions)) return

    const formattedAnswers = questions
      .map((q: any) => ({
        questionId: q.id,
        answer: answers()[q.id] || (q.type === "multi-choice" ? [] : ""),
      }))
      .filter((a: any) => {
        if (typeof a.answer === "string") return a.answer.length > 0
        if (Array.isArray(a.answer)) return a.answer.length > 0
        return false
      })

    if (props.onSubmit) {
      props.onSubmit(formattedAnswers)
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
      marginTop={0}
      backgroundColor={theme.backgroundPanel || "#1a1a1a"}
      borderColor={submitted() ? theme.success || "#00ff00" : theme.accent || "#0088ff"}
      flexShrink={0}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.text || "#ffffff"}>
        {questionConfig().title}
      </text>

      <Show when={questionConfig().description}>
        <text fg={theme.textMuted || "#808080"}>{questionConfig().description}</text>
      </Show>

      <Show when={!submitted()}>
        <box flexDirection="column" gap={1} marginTop={1}>
          <For each={questionConfig().questions}>
            {(question: any) => (
              <box flexDirection="column" gap={0}>
                <text fg={theme.text || "#ffffff"}>
                  {question.label}
                  <Show when={question.required !== false}>
                    <span style={{ fg: theme.error || "#ff0000" }}> *</span>
                  </Show>
                </text>

                {/* Single Choice */}
                <Show when={question.type === "single-choice" && question.options}>
                  <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                    <For each={question.options}>
                      {(option: string) => {
                        const isSelected = createMemo(() => answers()[question.id] === option)
                        return (
                          <text
                            fg={
                              isSelected()
                                ? theme.accent || "#0088ff"
                                : theme.textMuted || "#808080"
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
                      {(option: string) => {
                        const isSelected = createMemo(() => {
                          const current = answers()[question.id]
                          return Array.isArray(current) && current.includes(option)
                        })
                        return (
                          <text
                            fg={
                              isSelected()
                                ? theme.accent || "#0088ff"
                                : theme.textMuted || "#808080"
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

                {/* Text Input */}
                <Show when={question.type === "text"}>
                  <box marginTop={0}>
                    <text fg={theme.textMuted || "#808080"}>
                      {answers()[question.id]
                        ? `> ${answers()[question.id]}`
                        : `${question.placeholder || "Click to enter text..."}`}
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </For>
        </box>

        <box marginTop={1}>
          <text
            fg={
              allRequiredAnswered()
                ? hoveredSubmit()
                  ? theme.success || "#00ff00"
                  : theme.accent || "#0088ff"
                : theme.textMuted || "#808080"
            }
            attributes={allRequiredAnswered() ? TextAttributes.BOLD : undefined}
            onMouseOver={() => setHoveredSubmit(true)}
            onMouseOut={() => setHoveredSubmit(false)}
            onMouseUp={handleSubmit}
          >
            {allRequiredAnswered()
              ? `▶ ${questionConfig().submitLabel || "Submit Answers"}`
              : `○ ${questionConfig().submitLabel || "Submit Answers"} (complete required fields)`}
          </text>
        </box>
      </Show>

      <Show when={submitted()}>
        <box flexDirection="column" gap={0} marginTop={1}>
          <text fg={theme.success || "#00ff00"} attributes={TextAttributes.BOLD}>
            ✓ Answers submitted
          </text>
          <text fg={theme.textMuted || "#808080"}>Waiting for response...</text>
        </box>
      </Show>
    </box>
  )
}

/**
 * Built-in Form Widget Component
 */
function FormWidget(props: { config: any; onSubmit?: (values: any) => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [values, setValues] = createSignal<Record<string, any>>({})
  const [submitted, setSubmitted] = createSignal(false)
  const [hoveredSubmit, setHoveredSubmit] = createSignal(false)

  const formConfig = createMemo(() => {
    const config = props.config || {}
    return {
      title: config.title || "Form",
      description: config.description || "",
      fields: Array.isArray(config.fields) ? config.fields : [],
      submitLabel: config.submitLabel || "Submit",
    }
  })

  const allRequiredFilled = createMemo(() => {
    const fields = formConfig().fields
    if (!Array.isArray(fields)) return false
    const required = fields.filter((f: any) => f.required !== false && f.type !== "label")
    return required.every((f: any) => {
      const value = values()[f.id]
      if (value === undefined || value === null) return false
      if (typeof value === "string") return value.trim().length > 0
      if (typeof value === "number") return !isNaN(value)
      if (Array.isArray(value)) return value.length > 0
      return true
    })
  })

  const handleRadio = (fieldId: string, option: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: option }))
  }

  const handleCheckboxMulti = (fieldId: string, option: string) => {
    setValues((prev) => {
      const current = (prev[fieldId] || []) as string[]
      const updated = current.includes(option)
        ? current.filter((o: string) => o !== option)
        : [...current, option]
      return { ...prev, [fieldId]: updated }
    })
  }

  const handleCheckboxSingle = (fieldId: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }))
  }

  const handleDropdown = (fieldId: string, option: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: option }))
  }

  const handleTextInput = async (field: any) => {
    const currentValue = values()[field.id] || field.defaultValue || ""
    const result = await DialogPrompt.show(dialog, field.label || "Enter value", String(currentValue))
    if (result !== null) {
      if (field.type === "number") {
        const num = parseFloat(result)
        if (!isNaN(num)) {
          setValues((prev) => ({ ...prev, [field.id]: num }))
        }
      } else {
        setValues((prev) => ({ ...prev, [field.id]: result }))
      }
    }
  }

  const handleSubmit = () => {
    if (!allRequiredFilled()) return
    setSubmitted(true)

    const fields = formConfig().fields
    if (!Array.isArray(fields)) return

    const formattedValues = fields
      .filter((f: any) => f.type !== "label" && f.id)
      .map((f: any) => ({
        fieldId: f.id,
        value:
          values()[f.id] ??
          (f.type === "checkbox" && f.options ? [] : f.type === "checkbox" ? false : ""),
      }))
      .filter((v: any) => {
        if (typeof v.value === "string") return v.value.length > 0
        if (Array.isArray(v.value)) return v.value.length > 0
        return v.value !== null && v.value !== undefined
      })

    if (props.onSubmit) {
      props.onSubmit(formattedValues)
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
      marginTop={0}
      backgroundColor={theme.backgroundPanel || "#1a1a1a"}
      borderColor={submitted() ? theme.success || "#00ff00" : theme.accent || "#0088ff"}
      flexShrink={0}
    >
      <text attributes={TextAttributes.BOLD} fg={theme.text || "#ffffff"}>
        {formConfig().title}
      </text>

      <Show when={formConfig().description}>
        <text fg={theme.textMuted || "#808080"}>{formConfig().description}</text>
      </Show>

      <Show when={!submitted()}>
        <box flexDirection="column" gap={1} marginTop={1}>
          <For each={formConfig().fields}>
            {(field: any) => (
              <box flexDirection="column" gap={0}>
                <Show when={field.type === "label"}>
                  <text fg={theme.text || "#ffffff"} attributes={TextAttributes.BOLD}>
                    {field.content}
                  </text>
                </Show>

                <Show when={field.type !== "label" && field.label}>
                  <text fg={theme.text || "#ffffff"}>
                    {field.label}
                    <Show when={field.required !== false}>
                      <span style={{ fg: theme.error || "#ff0000" }}> *</span>
                    </Show>
                  </text>
                </Show>

                <Show when={field.type === "radio" && field.options}>
                  <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                    <For each={field.options}>
                      {(option: string) => {
                        const isSelected = createMemo(() => values()[field.id] === option)
                        return (
                          <text
                            fg={
                              isSelected()
                                ? theme.accent || "#0088ff"
                                : theme.textMuted || "#808080"
                            }
                            onMouseUp={() => handleRadio(field.id, option)}
                          >
                            {isSelected() ? "◉" : "○"} {option}
                          </text>
                        )
                      }}
                    </For>
                  </box>
                </Show>

                <Show when={field.type === "checkbox" && field.options}>
                  <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                    <For each={field.options}>
                      {(option: string) => {
                        const isSelected = createMemo(() => {
                          const current = values()[field.id]
                          return Array.isArray(current) && current.includes(option)
                        })
                        return (
                          <text
                            fg={
                              isSelected()
                                ? theme.accent || "#0088ff"
                                : theme.textMuted || "#808080"
                            }
                            onMouseUp={() => handleCheckboxMulti(field.id, option)}
                          >
                            {isSelected() ? "☑" : "☐"} {option}
                          </text>
                        )
                      }}
                    </For>
                  </box>
                </Show>

                <Show when={field.type === "checkbox" && !field.options}>
                  <box marginTop={0}>
                    <text
                      fg={
                        values()[field.id]
                          ? theme.accent || "#0088ff"
                          : theme.textMuted || "#808080"
                      }
                      onMouseUp={() => handleCheckboxSingle(field.id)}
                    >
                      {values()[field.id] ? "☑" : "☐"}{" "}
                      {values()[field.id] ? "Enabled" : "Disabled"}
                    </text>
                  </box>
                </Show>

                <Show when={field.type === "dropdown" && field.options}>
                  <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                    <For each={field.options}>
                      {(option: string) => {
                        const isSelected = createMemo(() => values()[field.id] === option)
                        return (
                          <text
                            fg={
                              isSelected()
                                ? theme.accent || "#0088ff"
                                : theme.textMuted || "#808080"
                            }
                            onMouseUp={() => handleDropdown(field.id, option)}
                          >
                            {isSelected() ? "◉" : "○"} {option}
                          </text>
                        )
                      }}
                    </For>
                  </box>
                </Show>

                <Show
                  when={
                    field.type === "text" || field.type === "textarea" || field.type === "number"
                  }
                >
                  <box marginTop={0}>
                    <text
                      fg={
                        values()[field.id]
                          ? theme.accent || "#0088ff"
                          : theme.textMuted || "#808080"
                      }
                      onMouseUp={() => handleTextInput(field)}
                    >
                      {values()[field.id]
                        ? `> ${values()[field.id]}`
                        : `${field.placeholder || "Click to enter..."}`}
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </For>
        </box>

        <box marginTop={1}>
          <text
            fg={
              allRequiredFilled()
                ? hoveredSubmit()
                  ? theme.success || "#00ff00"
                  : theme.accent || "#0088ff"
                : theme.textMuted || "#808080"
            }
            attributes={allRequiredFilled() ? TextAttributes.BOLD : undefined}
            onMouseOver={() => setHoveredSubmit(true)}
            onMouseOut={() => setHoveredSubmit(false)}
            onMouseUp={handleSubmit}
          >
            {allRequiredFilled()
              ? `▶ ${formConfig().submitLabel}`
              : `○ ${formConfig().submitLabel} (complete required fields)`}
          </text>
        </box>
      </Show>

      <Show when={submitted()}>
        <box flexDirection="column" gap={0} marginTop={1}>
          <text fg={theme.success || "#00ff00"} attributes={TextAttributes.BOLD}>
            ✓ Form submitted
          </text>
          <text fg={theme.textMuted || "#808080"}>Waiting for response...</text>
        </box>
      </Show>
    </box>
  )
}

export function PluginComponent(props: PluginComponentProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const [ComponentFn, setComponentFn] = createSignal<Component<any> | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  async function loadComponent() {
    setLoading(true)
    setError(null)
    try {
      console.log("[PluginComponent] Loading component:", props.componentId)
      const plugins = await Plugin.list()
      console.log("[PluginComponent] Found", plugins.length, "plugins")

      for (const plugin of plugins) {
        const uiRender = (plugin as any)["ui.render"]
        if (!uiRender) continue

        const output: any = {}
        const renderInput = {
          componentId: props.componentId,
          context: {
            ...props.context,
            client: sdk.client,
          },
        }
        console.log("[PluginComponent] Calling ui.render with:", {
          componentId: renderInput.componentId,
          contextKeys: Object.keys(renderInput.context),
        })
        await uiRender(renderInput, output)

        if (output.component) {
          // Store the component as a function that returns JSX
          // This way it will be called within the render tree
          console.log("[PluginComponent] ✓ Loaded component for:", props.componentId)
          setComponentFn(() => output.component)
          setLoading(false)
          return
        }
      }

      // Try core built-in renderers as fallback
      console.log(
        "[PluginComponent] No plugin found, checking core renderers for:",
        props.componentId,
      )
      const coreWidget = getCoreWidget(props.componentId)
      if (coreWidget) {
        console.log("[PluginComponent] ✓ Using core renderer for:", props.componentId)
        const coreComponent = getCoreRenderer(props.componentId, props.context || {})
        if (coreComponent) {
          setComponentFn(() => coreComponent)
          setLoading(false)
          return
        }
      }

      console.error("[PluginComponent] ✗ No plugin or core renderer found for:", props.componentId)
      setError(`No plugin can render component: ${props.componentId}`)
    } catch (err) {
      console.error("[PluginComponent] Error loading plugin:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    loadComponent()
  })

  return (
    <Show
      when={!loading()}
      fallback={
        <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
          {props.fallback || "Loading..."}
        </text>
      }
    >
      <Show when={!error()} fallback={<text fg={theme.error}>{error()}</text>}>
        <Show when={ComponentFn()} fallback={<text fg={theme.textMuted}>No component</text>}>
          {(() => {
            try {
              console.log("[PluginComponent] Rendering component for:", props.componentId)
              const Component = ComponentFn()!
              return <Component />
            } catch (err) {
              console.error("[PluginComponent] Render error:", err)
              return <text fg={theme.error}>Render error: {String(err)}</text>
            }
          })()}
        </Show>
      </Show>
    </Show>
  )
}
