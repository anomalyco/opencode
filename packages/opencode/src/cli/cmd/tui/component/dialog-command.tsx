import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  createEffect,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { TuiEvent } from "../event"
import type { KeybindsConfig } from "@opencode-ai/sdk/v2"
import path from "path"
import os from "os"
import { readdir } from "fs/promises"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type Slash = {
  name: string
  aliases?: string[]
}

export type CommandOption = DialogSelectOption<string> & {
  keybind?: keyof KeybindsConfig
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()

  const entries = createMemo(() => {
    const all = registrations().flatMap((x) => x())
    return all.map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = createMemo(() => entries().filter((option) => isVisible(option)))
  const suggestedOptions = createMemo(() =>
    visibleOptions()
      .filter((option) => option.suggested)
      .map((option) => ({
        ...option,
        value: `suggested:${option.value}`,
        category: "Suggested",
      })),
  )
  const suspended = () => suspendCount() > 0

  useKeyboard((evt) => {
    if (suspended()) return
    if (dialog.stack.length > 0) return
    for (const option of entries()) {
      if (!isEnabled(option)) continue
      if (option.keybind && keybind.match(option.keybind, evt)) {
        evt.preventDefault()
        option.onSelect?.(dialog)
        return
      }
    }
  })

  const result = {
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          option.onSelect?.(dialog)
          return
        }
      }
    },
    slashes() {
      return visibleOptions().flatMap((option) => {
        const slash = option.slash
        if (!slash) return []
        return {
          display: "/" + slash.name,
          description: option.description ?? option.title,
          aliases: slash.aliases?.map((alias) => "/" + alias),
          onSelect: () => result.trigger(option.value),
        }
      })
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replace(() => <DialogCommand options={visibleOptions()} suggestedOptions={suggestedOptions()} />)
    },
    register(cb: () => CommandOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      value.show()
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return props.options
    return [...props.suggestedOptions, ...props.options]
  }
  return <DialogSelect ref={(r) => (ref = r)} title="Commands" options={list()} />
}

export function DialogInsertFile() {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [dir, setDir] = createSignal(os.homedir())
  const [files, setFiles] = createSignal<string[]>([])

  createEffect(async () => {
    const current = dir()
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    const items = entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .filter((name) => !name.startsWith("."))
    setFiles(items)
  })

  const options = createMemo(() => {
    const current = dir()
    const items = files().map((name) => ({
      title: name,
      value: name,
      description: name.endsWith("/") ? "Directory" : "File",
    }))
    const parent = path.dirname(current)
    if (parent !== current) {
      items.unshift({
        title: "..",
        value: "..",
        description: "Parent directory",
      })
    }
    return items
  })

  return (
    <DialogSelect
      title={`Import text - ${dir()}`}
      placeholder="Search files"
      options={options()}
      onSelect={async (option) => {
        const current = dir()
        if (option.value === "..") {
          setDir(path.dirname(current))
          return
        }
        const name = option.value.endsWith("/") ? option.value.slice(0, -1) : option.value
        const target = path.join(current, name)
        if (option.value.endsWith("/")) {
          setDir(target)
          return
        }
        const file = Bun.file(target)
        if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
          toast.show({ message: "Use Import image for image files", variant: "warning" })
          return
        }
        const text = await file.text().catch(() => "")
        if (!text) {
          toast.show({ message: "File is empty or unreadable", variant: "warning" })
          return
        }
        const lines = (text.match(/\n/g)?.length ?? 0) + 1
        const label = file.type === "image/svg+xml"
          ? `[SVG: ${name}]`
          : lines > 1
            ? `[File: ${name}, ~${lines} lines]`
            : `[File: ${name}]`
        sdk.event.emit(TuiEvent.PromptInsert.type, {
          type: TuiEvent.PromptInsert.type,
          properties: {
            kind: "text",
            text,
            label,
          },
        })
        toast.show({ message: `Inserted ${name}`, variant: "info" })
        dialog.clear()
      }}
    />
  )
}

export function DialogInsertImage() {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const [dir, setDir] = createSignal(os.homedir())
  const [files, setFiles] = createSignal<string[]>([])

  createEffect(async () => {
    const current = dir()
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    const items = entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .filter((name) => !name.startsWith("."))
    setFiles(items)
  })

  const options = createMemo(() => {
    const current = dir()
    const items = files().map((name) => ({
      title: name,
      value: name,
      description: name.endsWith("/") ? "Directory" : "File",
    }))
    const parent = path.dirname(current)
    if (parent !== current) {
      items.unshift({
        title: "..",
        value: "..",
        description: "Parent directory",
      })
    }
    return items
  })

  return (
    <DialogSelect
      title={`Import image - ${dir()}`}
      placeholder="Search images"
      options={options()}
      onSelect={async (option) => {
        const current = dir()
        if (option.value === "..") {
          setDir(path.dirname(current))
          return
        }
        const name = option.value.endsWith("/") ? option.value.slice(0, -1) : option.value
        const target = path.join(current, name)
        if (option.value.endsWith("/")) {
          setDir(target)
          return
        }
        const file = Bun.file(target)
        if (file.type === "image/svg+xml") {
          const text = await file.text().catch(() => "")
          if (!text) {
            toast.show({ message: "SVG is empty or unreadable", variant: "warning" })
            return
          }
          sdk.event.emit(TuiEvent.PromptInsert.type, {
            type: TuiEvent.PromptInsert.type,
            properties: {
              kind: "text",
              text,
              label: `[SVG: ${name}]`,
            },
          })
          toast.show({ message: `Inserted ${name}`, variant: "info" })
          dialog.clear()
          return
        }
        if (!file.type.startsWith("image/")) {
          toast.show({ message: "Please select an image file", variant: "warning" })
          return
        }
        const content = await file
          .arrayBuffer()
          .then((buffer) => Buffer.from(buffer).toString("base64"))
          .catch(() => "")
        if (!content) {
          toast.show({ message: "Image is empty or unreadable", variant: "warning" })
          return
        }
        sdk.event.emit(TuiEvent.PromptInsert.type, {
          type: TuiEvent.PromptInsert.type,
          properties: {
            kind: "image",
            filename: name,
            mime: file.type || "application/octet-stream",
            content,
          },
        })
        toast.show({ message: `Inserted ${name}`, variant: "info" })
        dialog.clear()
      }}
    />
  )
}
