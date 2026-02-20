import path from "path"
import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import { Flag } from "@/flag/flag"

function esc(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parse(text: string) {
  return text.split(/\r?\n/).reduce(
    (result, line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) return result
      const clean = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed
      const index = clean.indexOf("=")
      if (index <= 0) return result
      result[clean.slice(0, index).trim()] = clean.slice(index + 1).trim()
      return result
    },
    {} as Record<string, string>,
  )
}

function edit(text: string, key: string, value: string) {
  const line = `${key}=${value}`
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((item) => new RegExp(`^\\s*(?:export\\s+)?${esc(key)}\\s*=`).test(item))
  if (index !== -1) {
    lines[index] = line
    return lines.join("\n")
  }
  if (text.length === 0) return line + "\n"
  const suffix = text.endsWith("\n") ? "" : "\n"
  return text + suffix + line + "\n"
}

function label(key: string) {
  return key.replace(/^OPENCODE_/, "").toLowerCase().replaceAll("_", " ")
}

export function DialogExperimental() {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  const file = createMemo(() => path.join(sync.data.path.directory || process.cwd(), ".env"))
  const [text, { refetch }] = createResource(
    file,
    (target) => {
      return Bun.file(target).text().catch(() => "")
    },
    { initialValue: "" },
  )
  const vars = createMemo(() => parse(text() ?? ""))
  const flags = createMemo(() => {
    const entries = Object.entries(Flag.types)
      .filter(([key]) => key.includes("EXPERIMENTAL"))
      .map(([key, type]) => ({ key, type }))
    const set = new Set(entries.map((item) => item.key))
    const extras = Object.keys(Flag)
      .filter((key) => key.includes("EXPERIMENTAL") && !set.has(key))
      .map((key) => ({ key, type: "boolean" as const }))
    return [...entries, ...extras].toSorted((a, b) => a.key.localeCompare(b.key))
  })

  const options = createMemo(() =>
    flags().map((flag) => {
      const current = vars()[flag.key]
      return {
        title: flag.key,
        value: flag.key,
        description: label(flag.key),
        category: flag.type === "number" ? "Numeric" : "Boolean",
        footer: current ? `Current: ${current}` : undefined,
      }
    }),
  )

  return (
    <DialogSelect
      title="Experimental flags"
      options={options()}
      onSelect={async (opt) => {
        const flag = flags().find((item) => item.key === opt.value)
        if (!flag) return

        let value = "true"
        if (flag.type === "number") {
          let input = vars()[flag.key]
          while (true) {
            const result = await DialogPrompt.show(dialog, flag.key, {
              value: input,
              placeholder: "Positive integer",
            })
            if (result === null) return
            value = result.trim()
            if (/^[1-9]\d*$/.test(value)) break
            toast.show({
              variant: "error",
              message: "Value must be a positive integer",
            })
            input = result
          }
        }

        const output = edit(text() ?? "", flag.key, value)
        const saved = await Bun.write(file(), output)
          .then(() => true)
          .catch(() => false)

        if (!saved) {
          toast.show({
            variant: "error",
            message: `Failed to write ${file()}`,
          })
          return
        }

        process.env[flag.key] = value
        await refetch()
        dialog.clear()
        toast.show({
          variant: "success",
          message: `Enabled ${flag.key} in ${file()}. Restart OpenCode to apply.`,
          duration: 6000,
        })
      }}
    />
  )
}
