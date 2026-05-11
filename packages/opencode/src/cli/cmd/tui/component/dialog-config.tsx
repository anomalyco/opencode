import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

type ConfigFieldType =
  | { kind: "enum"; values: string[] }
  | { kind: "boolean" }
  | { kind: "string"; example?: string }
  | { kind: "number"; example?: string }

type ConfigField = {
  key: string
  description: string
  type: ConfigFieldType
}

const configFields: ConfigField[] = [
  {
    key: "shell",
    description: "Default shell to use for terminal and bash tool",
    type: { kind: "string", example: "/bin/zsh" },
  },
  {
    key: "logLevel",
    description: "Log level",
    type: { kind: "enum", values: ["DEBUG", "INFO", "WARN", "ERROR"] },
  },
  {
    key: "model",
    description: "Model to use in the format of provider/model",
    type: { kind: "string", example: "anthropic/claude-3.5-sonnet" },
  },
  {
    key: "small_model",
    description: "Small model for tasks like title generation",
    type: { kind: "string", example: "anthropic/claude-3-haiku" },
  },
  {
    key: "default_agent",
    description: "Default agent to use when none is specified",
    type: { kind: "string", example: "build" },
  },
  {
    key: "username",
    description: "Custom username to display in conversations",
    type: { kind: "string", example: "johndoe" },
  },
  {
    key: "snapshot",
    description: "Enable or disable snapshot tracking",
    type: { kind: "boolean" },
  },
  {
    key: "share",
    description: "Control sharing behavior",
    type: { kind: "enum", values: ["manual", "auto", "disabled"] },
  },
  {
    key: "autoshare",
    description: "Share newly created sessions automatically",
    type: { kind: "boolean" },
  },
  {
    key: "autoupdate",
    description: "Automatically update to the latest version",
    type: { kind: "enum", values: ["true", "false", "notify"] },
  },
]

export function DialogConfig(props: { gotoKey?: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const gotoField = props.gotoKey ? configFields.find((f) => f.key === props.gotoKey) : undefined

  async function saveField(field: ConfigField, value: unknown): Promise<boolean> {
    try {
      let parsedValue: unknown = value
      if (field.type.kind === "boolean") {
        parsedValue = value === "true" || value === true
      } else if (field.type.kind === "number") {
        parsedValue = Number(value)
        if (Number.isNaN(parsedValue)) throw new Error("Invalid number")
      } else if (field.type.kind === "enum" && field.key === "autoupdate") {
        if (value === "true") parsedValue = true
        else if (value === "false") parsedValue = false
      }

      const result = await sdk.client.config.update(
        { config: { [field.key]: parsedValue } },
        { throwOnError: true },
      )

      if (result.error) {
        throw new Error(result.error.message || "Failed to update config")
      }

      toast.show({ message: `Updated ${field.key}`, variant: "success" })
      return true
    } catch (error) {
      toast.show({
        message: `Failed to update ${field.key}: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
      return false
    }
  }

  function openEdit(field: ConfigField) {
    const currentValue = sync.data.config[field.key as keyof typeof sync.data.config]
    dialog.replace(() => (
      <DialogConfigEdit
        field={field}
        currentValue={currentValue}
        onSave={async (value) => {
          const success = await saveField(field, value)
          if (success) dialog.replace(() => <DialogConfig />)
        }}
      />
    ))
  }

  if (gotoField) {
    const currentValue = sync.data.config[gotoField.key as keyof typeof sync.data.config]
    return (
      <DialogConfigEdit
        field={gotoField}
        currentValue={currentValue}
        onSave={async (value) => {
          const success = await saveField(gotoField, value)
          if (success) dialog.replace(() => <DialogConfig />)
        }}
      />
    )
  }

  const options = createMemo(() =>
    configFields.map((field) => {
      const currentValue = sync.data.config[field.key as keyof typeof sync.data.config]
      const currentText = currentValue !== undefined ? ` = ${JSON.stringify(currentValue)}` : " (not set)"
      return {
        title: field.key,
        value: field,
        description: field.description + currentText,
      }
    }),
  )

  return (
    <DialogSelect
      title="Config"
      placeholder="Search config..."
      options={options()}
      onSelect={(option) => openEdit(option.value)}
    />
  )
}

function DialogConfigEdit(props: {
  field: ConfigField
  currentValue: unknown
  onSave: (value: unknown) => Promise<void>
}) {
  const dialog = useDialog()

  if (props.field.type.kind === "enum" || props.field.type.kind === "boolean") {
    const values = props.field.type.kind === "boolean" ? ["true", "false"] : props.field.type.values
    const currentString = props.currentValue === undefined ? undefined : String(props.currentValue)

    return (
      <DialogSelect
        title={`Edit ${props.field.key}`}
        options={values.map((v) => ({
          title: v,
          value: v,
        }))}
        current={currentString}
        onSelect={(opt) => props.onSave(opt.value)}
      />
    )
  }

  return (
    <DialogPrompt
      title={`Edit ${props.field.key}`}
      description={() => (
        <text>{props.field.description}</text>
      )}
      value={props.currentValue !== undefined ? String(props.currentValue) : ""}
      placeholder={props.field.type.example ?? `Enter ${props.field.type.kind}`}
      onConfirm={(value) => props.onSave(value)}
    />
  )
}
