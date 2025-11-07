/**
 * Forms Plugin
 *
 * Allows the model to display interactive forms within the message list.
 * Users can fill out text inputs, numbers, checkboxes, and select dropdowns.
 *
 * This enables the model to collect structured input before executing operations.
 *
 * ## Usage in Message Stream
 *
 * The model can display a form by including special text in its response:
 *
 * ```
 * <form id="add-directory">
 * {
 *   "title": "Add External Directory",
 *   "description": "Add a directory from anywhere on your filesystem",
 *   "fields": [
 *     {
 *       "id": "directory",
 *       "label": "Directory Path",
 *       "type": "path",
 *       "placeholder": "/absolute/path/to/directory",
 *       "required": true
 *     }
 *   ],
 *   "submitLabel": "Add Directory"
 * }
 * </form>
 * ```
 */

/** @jsxImportSource @opentui/solid */

import { createSignal, Show, createMemo } from "../../src/plugin-ui"
import { TextAttributes } from "../../src/plugin-ui"

export interface FormField {
  id: string
  label?: string
  type: "text" | "textarea" | "number" | "radio" | "checkbox" | "dropdown" | "label"
  placeholder?: string
  options?: string[]
  required?: boolean
  defaultValue?: string | number | boolean
  content?: string // For label type
}

export interface FormConfig {
  title: string
  description?: string
  fields: FormField[]
  submitLabel?: string
}

export interface FormValue {
  fieldId: string
  value: string | number | boolean | string[]
}

export const FormsPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      output.messageWidgets = [
        {
          id: "form",
          pattern: /<form[^>]*>([\s\S]*?)<\/form>/g,
          systemPrompt: `# Interactive Forms

You can display interactive forms to collect user input inline in the conversation.

## Usage

Include a <form> widget in your response:

\`\`\`
<form id="unique-id">
{
  "title": "Form Title",
  "description": "Optional description",
  "fields": [
    {
      "id": "name",
      "label": "Your Name",
      "type": "text",
      "placeholder": "Enter name...",
      "required": true
    },
    {
      "id": "bio",
      "label": "Biography",
      "type": "textarea",
      "placeholder": "Tell us about yourself...",
      "required": false
    },
    {
      "id": "framework",
      "label": "Framework",
      "type": "radio",
      "options": ["React", "Vue", "Svelte"],
      "required": true
    },
    {
      "id": "features",
      "label": "Features",
      "type": "checkbox",
      "options": ["Dark Mode", "Auth", "API"],
      "required": false
    },
    {
      "id": "region",
      "label": "Region",
      "type": "dropdown",
      "options": ["US", "EU", "ASIA"],
      "required": true
    },
    {
      "type": "label",
      "content": "Additional Information"
    }
  ],
  "submitLabel": "Submit"
}
</form>
\`\`\`

## Field Types

- **text**: Single line text input
- **textarea**: Multi-line text input
- **number**: Numeric input
- **radio**: Single selection from options (radio buttons)
- **checkbox**: Multiple selection from options (checkboxes) - returns array
- **dropdown**: Dropdown/select menu
- **label**: Display text only (no input, no ID needed)

## Example: Add Directory

\`\`\`
<form id="add-directory">
{
  "title": "Add External Directory",
  "fields": [
    {
      "id": "directory",
      "label": "Directory Path",
      "type": "text",
      "placeholder": "/absolute/path/to/directory",
      "required": true
    }
  ]
}
</form>
\`\`\``,
        },
      ]
    },

    "ui.render": async (input: any, output: any) => {
      const { componentId, context } = input

      if (componentId === "form") {
        const { config, onSubmit, theme } = context

        const FormWidget = () => {
          const formConfig: FormConfig = config
          const [values, setValues] = createSignal<Record<string, any>>({})
          const [submitted, setSubmitted] = createSignal(false)
          const [hoveredSubmit, setHoveredSubmit] = createSignal(false)
          const [activeField, setActiveField] = createSignal<string | null>(null)

          if (!formConfig || !formConfig.fields || !Array.isArray(formConfig.fields)) {
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
                  ✗ Invalid Form Configuration
                </text>
                <text fg={theme?.textMuted || "#808080"}>
                  The form widget requires a valid config with a 'fields' array.
                </text>
              </box>
            )
          }

          const allRequiredFilled = createMemo(() => {
            const required = formConfig.fields.filter(
              (f) => f.required !== false && f.type !== "label",
            )
            return required.every((f) => {
              const value = values()[f.id]
              if (value === undefined || value === null) return false
              if (typeof value === "string") return value.trim().length > 0
              if (typeof value === "number") return !isNaN(value)
              if (Array.isArray(value)) return value.length > 0
              return true
            })
          })

          const handleRadio = (fieldId: string, option: string) => {
            setValues((prev) => ({
              ...prev,
              [fieldId]: option,
            }))
          }

          const handleCheckboxMulti = (fieldId: string, option: string) => {
            setValues((prev) => {
              const current = (prev[fieldId] as string[]) || []
              const updated = current.includes(option)
                ? current.filter((o) => o !== option)
                : [...current, option]
              return { ...prev, [fieldId]: updated }
            })
          }

          const handleCheckboxSingle = (fieldId: string) => {
            setValues((prev) => ({
              ...prev,
              [fieldId]: !prev[fieldId],
            }))
          }

          const handleDropdown = (fieldId: string, option: string) => {
            setValues((prev) => ({
              ...prev,
              [fieldId]: option,
            }))
          }

          const handleSubmit = () => {
            if (!allRequiredFilled()) return
            setSubmitted(true)

            const formattedValues: FormValue[] = formConfig.fields
              .filter((f) => f.type !== "label" && f.id)
              .map((f) => ({
                fieldId: f.id,
                value:
                  values()[f.id] ??
                  (f.type === "checkbox" && f.options ? [] : f.type === "checkbox" ? false : ""),
              }))
              .filter((v) => {
                if (typeof v.value === "string") return v.value.length > 0
                if (Array.isArray(v.value)) return v.value.length > 0
                return v.value !== null && v.value !== undefined
              })

            if (onSubmit) {
              onSubmit(formattedValues)
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
              backgroundColor={theme?.backgroundPanel || "#1a1a1a"}
              borderColor={submitted() ? theme?.success || "#00ff00" : theme?.accent || "#0088ff"}
              flexShrink={0}
            >
              <text attributes={TextAttributes.BOLD} fg={theme?.text || "#ffffff"}>
                {formConfig.title}
              </text>

              <Show when={formConfig.description}>
                <text fg={theme?.textMuted || "#808080"}>{formConfig.description}</text>
              </Show>

              <Show when={!submitted()}>
                <box flexDirection="column" gap={1} marginTop={1}>
                  {formConfig.fields.map((field) => (
                    <box flexDirection="column" gap={0}>
                      {/* Label type - just display text */}
                      <Show when={field.type === "label"}>
                        <text fg={theme?.text || "#ffffff"} attributes={TextAttributes.BOLD}>
                          {field.content}
                        </text>
                      </Show>

                      {/* All other types - show label if present */}
                      <Show when={field.type !== "label" && field.label}>
                        <text fg={theme?.text || "#ffffff"}>
                          {field.label}
                          <Show when={field.required !== false}>
                            <span style={{ fg: theme?.error || "#ff0000" }}> *</span>
                          </Show>
                        </text>
                      </Show>

                      {/* Radio - single selection with options */}
                      <Show when={field.type === "radio" && field.options}>
                        <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                          {field.options?.map((option) => {
                            const isSelected = createMemo(() => values()[field.id] === option)
                            return (
                              <text
                                fg={
                                  isSelected()
                                    ? theme?.accent || "#0088ff"
                                    : theme?.textMuted || "#808080"
                                }
                                onMouseUp={() => handleRadio(field.id, option)}
                              >
                                {isSelected() ? "◉" : "○"} {option}
                              </text>
                            )
                          })}
                        </box>
                      </Show>

                      {/* Checkbox with options - multi-select */}
                      <Show when={field.type === "checkbox" && field.options}>
                        <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                          {field.options?.map((option) => {
                            const isSelected = createMemo(() => {
                              const current = values()[field.id]
                              return Array.isArray(current) && current.includes(option)
                            })
                            return (
                              <text
                                fg={
                                  isSelected()
                                    ? theme?.accent || "#0088ff"
                                    : theme?.textMuted || "#808080"
                                }
                                onMouseUp={() => handleCheckboxMulti(field.id, option)}
                              >
                                {isSelected() ? "☑" : "☐"} {option}
                              </text>
                            )
                          })}
                        </box>
                      </Show>

                      {/* Checkbox without options - single boolean */}
                      <Show when={field.type === "checkbox" && !field.options}>
                        <box marginTop={0}>
                          <text
                            fg={
                              values()[field.id]
                                ? theme?.accent || "#0088ff"
                                : theme?.textMuted || "#808080"
                            }
                            onMouseUp={() => handleCheckboxSingle(field.id)}
                          >
                            {values()[field.id] ? "☑" : "☐"}{" "}
                            {values()[field.id] ? "Enabled" : "Disabled"}
                          </text>
                        </box>
                      </Show>

                      {/* Dropdown - select menu */}
                      <Show when={field.type === "dropdown" && field.options}>
                        <box flexDirection="row" gap={2} marginTop={0} flexWrap="wrap">
                          {field.options?.map((option) => {
                            const isSelected = createMemo(() => values()[field.id] === option)
                            return (
                              <text
                                fg={
                                  isSelected()
                                    ? theme?.accent || "#0088ff"
                                    : theme?.textMuted || "#808080"
                                }
                                onMouseUp={() => handleDropdown(field.id, option)}
                              >
                                {isSelected() ? "◉" : "○"} {option}
                              </text>
                            )
                          })}
                        </box>
                      </Show>

                      {/* Text input */}
                      <Show when={field.type === "text"}>
                        <box marginTop={0}>
                          <text fg={theme?.textMuted || "#808080"}>
                            {values()[field.id]
                              ? `> ${values()[field.id]}`
                              : `${field.placeholder || "Click to enter..."}`}
                          </text>
                        </box>
                      </Show>

                      {/* Textarea input */}
                      <Show when={field.type === "textarea"}>
                        <box marginTop={0}>
                          <text fg={theme?.textMuted || "#808080"}>
                            {values()[field.id]
                              ? `> ${values()[field.id]}`
                              : `${field.placeholder || "Click to enter..."}`}
                          </text>
                        </box>
                      </Show>

                      {/* Number input */}
                      <Show when={field.type === "number"}>
                        <box marginTop={0}>
                          <text fg={theme?.textMuted || "#808080"}>
                            {values()[field.id]
                              ? `> ${values()[field.id]}`
                              : `${field.placeholder || "Click to enter..."}`}
                          </text>
                        </box>
                      </Show>
                    </box>
                  ))}
                </box>

                <box marginTop={1}>
                  <text
                    fg={
                      allRequiredFilled()
                        ? hoveredSubmit()
                          ? theme?.success || "#00ff00"
                          : theme?.accent || "#0088ff"
                        : theme?.textMuted || "#808080"
                    }
                    attributes={allRequiredFilled() ? TextAttributes.BOLD : undefined}
                    onMouseOver={() => setHoveredSubmit(true)}
                    onMouseOut={() => setHoveredSubmit(false)}
                    onMouseUp={handleSubmit}
                  >
                    {allRequiredFilled()
                      ? `▶ ${formConfig.submitLabel || "Submit"}`
                      : `○ ${formConfig.submitLabel || "Submit"} (complete required fields)`}
                  </text>
                </box>
              </Show>

              <Show when={submitted()}>
                <box flexDirection="column" gap={0} marginTop={1}>
                  <text fg={theme?.success || "#00ff00"} attributes={TextAttributes.BOLD}>
                    ✓ Form Submitted
                  </text>
                  {formConfig.fields
                    .filter((field) => field.type !== "label" && field.id)
                    .map((field) => {
                      const value = values()[field.id]
                      if (value === undefined || value === null) return null
                      return (
                        <box flexDirection="row" gap={1} marginTop={0}>
                          <text fg={theme?.textMuted || "#808080"}>{field.label}:</text>
                          <text fg={theme?.text || "#ffffff"}>
                            {typeof value === "boolean"
                              ? value
                                ? "Yes"
                                : "No"
                              : Array.isArray(value)
                                ? value.join(", ")
                                : String(value)}
                          </text>
                        </box>
                      )
                    })}
                </box>
              </Show>
            </box>
          )
        }

        output.component = FormWidget
        output.type = "component"
      }
    },
  }
}

export default FormsPlugin
