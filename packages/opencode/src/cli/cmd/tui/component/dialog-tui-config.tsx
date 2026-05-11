import path from "path"
import { rename } from "fs/promises"
import { createMemo, createResource, createSignal } from "solid-js"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { TuiInfo } from "@/cli/cmd/tui/config/tui-schema"

type TuiConfigFieldType =
  | { kind: "enum"; values: string[] }
  | { kind: "boolean" }
  | { kind: "string"; example?: string }
  | { kind: "number"; example?: string }

type TuiConfigField = {
  key: string
  description: string
  type: TuiConfigFieldType
}

const tuiConfigFields: TuiConfigField[] = [
  {
    key: "theme",
    description: "Theme name",
    type: { kind: "string", example: "opencode" },
  },
  {
    key: "diff_style",
    description: "Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column",
    type: { kind: "enum", values: ["auto", "stacked"] },
  },
  {
    key: "mouse",
    description: "Enable or disable mouse capture (default: true)",
    type: { kind: "boolean" },
  },
  {
    key: "scroll_speed",
    description: "TUI scroll speed",
    type: { kind: "number", example: "1.0" },
  },
  {
    key: "leader_timeout",
    description: "Leader key timeout in milliseconds",
    type: { kind: "number", example: "2000" },
  },
]

const tuiConfigPath = path.join(Global.Path.config, "tui.json")

export function DialogTuiConfig(props: { gotoKey?: string }) {
  const dialog = useDialog()
  const toast = useToast()

  const [refreshTick, setRefreshTick] = createSignal(0)

  const [tuiFileConfig] = createResource(
    refreshTick,
    async () => {
      return Filesystem.readJson<Record<string, unknown>>(tuiConfigPath).catch(() => ({}))
    },
  )

  const gotoField = props.gotoKey ? tuiConfigFields.find((f) => f.key === props.gotoKey) : undefined

  function formatValidationError(error: unknown): string {
    if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
      return error.issues.map((issue: any) => issue.message).join("; ")
    }
    if (error instanceof Error) return error.message
    return String(error)
  }

  async function saveField(field: TuiConfigField, value: unknown): Promise<boolean> {
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
      }

      const existing = await Filesystem.readJson<Record<string, unknown>>(tuiConfigPath).catch(() => ({}))

      // Backup existing config before modification
      const backupPath = `${tuiConfigPath}.bak`
      await Filesystem.write(backupPath, JSON.stringify(existing, null, 2))

      const updated = { ...existing, [field.key]: parsedValue }

      // Validate only the changed field against the TUI config schema
      const fieldSchema = TuiInfo.shape[field.key as keyof typeof TuiInfo.shape]
      if (fieldSchema) {
        fieldSchema.parse(parsedValue)
      } else {
        throw new Error(`Unknown field: ${field.key}`)
      }

      // Atomic write: write to temp file then rename
      const tempPath = `${tuiConfigPath}.${process.pid}.${Date.now()}.tmp`
      await Filesystem.writeJson(tempPath, updated)
      await rename(tempPath, tuiConfigPath)

      toast.show({ message: `Updated ${field.key}`, variant: "success" })
      setRefreshTick((t) => t + 1)
      return true
    } catch (error) {
      toast.show({
        message: `Failed to update ${field.key}: ${formatValidationError(error)}`,
        variant: "error",
      })
      return false
    }
  }

  function getCurrentValue(field: TuiConfigField): unknown {
    return tuiFileConfig()?.[field.key]
  }

  function openEdit(field: TuiConfigField) {
    const currentValue = getCurrentValue(field)
    dialog.push(() => (
      <DialogTuiConfigEdit
        field={field}
        currentValue={currentValue}
        onSave={async (value) => {
          const success = await saveField(field, value)
          if (success) dialog.replace(() => <DialogTuiConfig />)
        }}
        onCancel={() => {
          dialog.replace(() => <DialogTuiConfig />)
        }}
      />
    ))
  }

  if (gotoField) {
    const currentValue = getCurrentValue(gotoField)
    return (
      <DialogTuiConfigEdit
        field={gotoField}
        currentValue={currentValue}
        onSave={async (value) => {
          const success = await saveField(gotoField, value)
          if (success) dialog.replace(() => <DialogTuiConfig />)
        }}
        onCancel={() => {
          dialog.replace(() => <DialogTuiConfig />)
        }}
      />
    )
  }

  const options = createMemo(() => {
    const config = tuiFileConfig() ?? {}
    return tuiConfigFields.map((field) => {
      const currentValue = config[field.key]
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
      title="TUI Config"
      placeholder="Search TUI config..."
      options={options()}
      onSelect={(option) => openEdit(option.value)}
    />
  )
}

function DialogTuiConfigEdit(props: {
  field: TuiConfigField
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
      description={() => <text>{props.field.description}</text>}
      value={initialValue}
      placeholder={props.field.type.example ?? `Enter ${props.field.type.kind}`}
      onConfirm={(value) => props.onSave(value)}
      onCancel={() => props.onCancel()}
    />
  )
}
