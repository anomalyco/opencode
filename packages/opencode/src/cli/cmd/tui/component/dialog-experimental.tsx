import path from "path"
import { rename } from "node:fs/promises"
import { createEffect, createMemo, createResource } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import { Flag } from "@/flag/flag"
import { ENV_EXPORT, ENV_KEY, ENV_LABEL, ENV_LINE, ENV_NUMBER } from "./dialog-experimental.const"

function parse(text: string) {
  return Object.fromEntries(
    text.split(ENV_LINE).flatMap((item) => {
      const match = item.match(ENV_KEY)
      if (!match?.[1]) return []
      const key = match[1].replace(ENV_EXPORT, "")
      const value = item.slice(match[0].length).trim()
      if (value.startsWith('"') && value.endsWith('"')) return [[key, value.slice(1, -1).replaceAll('\\"', '"')]]
      if (value.startsWith("'") && value.endsWith("'")) return [[key, value.slice(1, -1)]]
      return [[key, value.replace(/\s+#.*$/, "").trimEnd()]]
    }),
  )
}

function edit(text: string, key: string, value: string) {
  const line = `${key}=${value}`
  const lines = text.split(ENV_LINE)
  const index = lines.findIndex((item) => {
    const match = item.match(ENV_KEY)
    if (!match?.[1]) return false
    const name = match[1].replace(ENV_EXPORT, "")
    return name === key
  })
  if (index !== -1) {
    lines[index] = line
    return lines.join("\n")
  }
  if (text.length === 0) return line + "\n"
  const suffix = text.endsWith("\n") ? "" : "\n"
  return text + suffix + line + "\n"
}

function label(key: string) {
  return key.replace(ENV_LABEL, "").toLowerCase().replaceAll("_", " ")
}

export function DialogExperimental() {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  const file = createMemo(() => path.join(sync.data.path.directory || process.cwd(), ".env"))
  const [text, { refetch }] = createResource(
    file,
    async (target) => {
      const source = Bun.file(target)
      if (!(await source.exists())) return ""
      return source.text()
    },
    { initialValue: "" },
  )
  const vars = createMemo(() => parse(text() ?? ""))
  const flags = createMemo(() => Flag.getExperimental())

  createEffect(() => {
    if (!text.error) return
    toast.show({
      variant: "error",
      message: `Failed to read ${file()}: ${text.error.message}`,
    })
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
            if (ENV_NUMBER.test(value)) break
            toast.show({
              variant: "error",
              message: "Value must be a positive integer",
            })
            input = result
          }
        }

        const output = edit(text() ?? "", flag.key, value)
        const temp = `${file()}.${process.pid}.${Date.now()}.tmp`
        const saved = await Bun.write(temp, output)
          .then(() => rename(temp, file()))
          .then(() => true)
          .catch(async (error) => {
            await Bun.file(temp)
              .delete()
              .catch(() => {})
            toast.show({
              variant: "error",
              message: `Failed to write ${file()}: ${error instanceof Error ? error.message : String(error)}`,
            })
            return false
          })

        if (!saved) return

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
