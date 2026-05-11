import { createMemo, createSignal } from "solid-js"
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

type ConfigScope = "project" | "global"

export function DialogConfig(props: { scope?: ConfigScope }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const resolvedScope = props.scope

  const [globalConfig, setGlobalConfig] = createSignal<Record<string, unknown>>({})

  async function fetchGlobalConfig() {
    try {
      const result = await sdk.client.global.config.get({ throwOnError: true })
      setGlobalConfig(result.data ?? {})
    } catch {
      setGlobalConfig({})
    }
  }

  if (resolvedScope === "global") {
    void fetchGlobalConfig()
  }

  function formatError(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
    return String(error)
  }

  async function saveField(field: ConfigField, value: unknown, targetScope: ConfigScope): Promise<boolean> {
    try {
      let parsedValue: unknown = value
      if (field.type.kind === "boolean") {
        parsedValue = value === "true" || value === true
      } else if (field.type.kind === "number") {
        const raw = value === "" || value === undefined || value === null ? field.type.example : String(value)
        parsedValue = Number(raw)
        if (Number.isNaN(parsedValue)) throw new Error("Invalid number")
      } else if (field.type.kind === "string" && value === "") {
        parsedValue = field.type.example ?? ""
      } else if (field.type.kind === "enum" && field.key === "autoupdate") {
        if (value === "true") parsedValue = true
        else if (value === "false") parsedValue = false
      }

      if (targetScope === "global") {
        await sdk.client.global.config.update(
          { config: { [field.key]: parsedValue } },
          { throwOnError: true },
        )
      } else {
        await sdk.client.config.update(
          { config: { [field.key]: parsedValue } },
          { throwOnError: true },
        )
      }

      toast.show({ message: `Updated ${field.key} (${targetScope})`, variant: "success" })
      return true
    } catch (error) {
      toast.show({
        message: `Failed to update ${field.key}: ${formatError(error)}`,
        variant: "error",
      })
      return false
    }
  }

  function openEdit(field: ConfigField, targetScope: ConfigScope) {
    const currentValue =
      targetScope === "global"
        ? globalConfig()[field.key as keyof typeof globalConfig]
        : sync.data.config[field.key as keyof typeof sync.data.config]
    dialog.push(() => (
      <DialogConfigEdit
        field={field}
        currentValue={currentValue}
        onSave={async (value) => {
          const success = await saveField(field, value, targetScope)
          if (success) dialog.replace(() => <DialogConfig scope={targetScope} />)
        }}
        onCancel={() => {
          dialog.replace(() => <DialogConfig scope={targetScope} />)
        }}
      />
    ))
  }

  if (!resolvedScope) {
    return (
      <DialogSelect
        title="Config Scope"
        placeholder="Choose config scope..."
        options={[
          { title: "Project config", value: "project", description: "Edit config.json in the current directory" },
          { title: "Global config", value: "global", description: "Edit ~/.config/opencode/opencode.json" },
        ]}
        onSelect={(option) => {
          dialog.replace(() => <DialogConfig scope={option.value as ConfigScope} />)
        }}
      />
    )
  }

  const options = createMemo(() => {
    const configSource = resolvedScope === "global" ? globalConfig() : sync.data.config
    return configFields.map((field) => {
      const currentValue = configSource[field.key as keyof typeof configSource]
      const currentText = currentValue !== undefined ? ` = ${JSON.stringify(currentValue)}` : " (not set)"
      return {
        title: field.key,
        value: field,
        description: field.description + currentText,
      }
    })
  })

  return (
    <DialogSelect
      title={`Config (${resolvedScope})`}
      placeholder="Search config..."
      options={options()}
      onSelect={(option) => openEdit(option.value, resolvedScope)}
    />
  )
}

function DialogConfigEdit(props: {
  field: ConfigField
  currentValue: unknown
  onSave: (value: unknown) => Promise<void>
  onCancel: () => void
}) {
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
        actions={[
          {
            command: "dialog.cancel",
            title: "Cancel",
            side: "right",
            onTrigger: () => props.onCancel(),
          },
        ]}
      />
    )
  }

  const initialValue = props.currentValue !== undefined
    ? String(props.currentValue)
    : (props.field.type.example ?? "")

  return (
    <DialogPrompt
      title={`Edit ${props.field.key}`}
      description={() => (
        <text>{props.field.description}</text>
      )}
      value={initialValue}
      placeholder={props.field.type.example ?? `Enter ${props.field.type.kind}`}
      onConfirm={(value) => props.onSave(value)}
      onCancel={() => props.onCancel()}
    />
  )
}
