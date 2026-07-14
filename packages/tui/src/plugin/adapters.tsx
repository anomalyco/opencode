import type { TuiDialogSelectOption, TuiPluginApi, TuiSlotProps } from "@opencode-ai/plugin/tui"
import type { Config } from "../config"
import type { useEvent } from "../context/event"
import type { useRoute } from "../context/route"
import type { useClient } from "../context/client"
import type { useData } from "../context/data"
import type { useProject } from "../context/project"
import type { useTheme } from "../context/theme"
import { Dialog as DialogUI, type useDialog } from "../ui/dialog"
import type { useOpencodeKeymap } from "../keymap"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption as SelectOption } from "../ui/dialog-select"
import { Prompt } from "../component/prompt"
import type { useToast } from "../ui/toast"
import * as Keymap from "../keymap"
import { createCommandShim } from "./command-shim"
import type { PluginRoutes } from "./api"
export type { RouteMap } from "./api"
export { createPluginRoutes, createTuiApi } from "./api"

type Input = {
  version: string
  tuiConfig: Config.Resolved
  dialog: ReturnType<typeof useDialog>
  keymap: ReturnType<typeof useOpencodeKeymap>
  route: ReturnType<typeof useRoute>
  routes: PluginRoutes
  event: ReturnType<typeof useEvent>
  client: ReturnType<typeof useClient>
  project: ReturnType<typeof useProject>
  data: ReturnType<typeof useData>
  theme: ReturnType<typeof useTheme>
  toast: ReturnType<typeof useToast>
  renderer: TuiPluginApi["renderer"]
  attention: TuiPluginApi["attention"]
  Slot: TuiPluginApi["ui"]["Slot"]
}

function routeNavigate(route: ReturnType<typeof useRoute>, name: string, params?: Record<string, unknown>) {
  if (name === "home") {
    route.navigate({ type: "home" })
    return
  }

  if (name === "session") {
    const sessionID = params?.sessionID
    if (typeof sessionID !== "string") return
    route.navigate({ type: "session", sessionID })
    return
  }

  route.navigate({ type: "plugin", id: name, data: params })
}

function routeCurrent(route: ReturnType<typeof useRoute>): TuiPluginApi["route"]["current"] {
  if (route.data.type === "home") return { name: "home" }
  if (route.data.type === "session") {
    return {
      name: "session",
      params: {
        sessionID: route.data.sessionID,
        prompt: route.data.prompt,
      },
    }
  }

  return {
    name: route.data.id,
    params: route.data.data,
  }
}

function mapOption<Value>(item: TuiDialogSelectOption<Value>): SelectOption<Value> {
  return {
    ...item,
    onSelect: () => item.onSelect?.(),
  }
}

function pickOption<Value>(item: SelectOption<Value>): TuiDialogSelectOption<Value> {
  return {
    title: item.title,
    value: item.value,
    description: item.description,
    footer: item.footer,
    category: item.category,
    disabled: item.disabled,
  }
}

function mapOptionCb<Value>(cb?: (item: TuiDialogSelectOption<Value>) => void) {
  if (!cb) return
  return (item: SelectOption<Value>) => cb(pickOption(item))
}

function stateApi(project: ReturnType<typeof useProject>, data: ReturnType<typeof useData>): TuiPluginApi["state"] {
  return {
    get ready() {
      return true
    },
    get config() {
      return {}
    },
    get provider() {
      return []
    },
    get path() {
      return project.instance.path()
    },
    get vcs() {
      return undefined
    },
    session: {
      count() {
        return data.session.list().length
      },
      get(_sessionID) {
        return undefined
      },
      diff(_sessionID) {
        return []
      },
      messages(_sessionID) {
        return []
      },
      status(sessionID) {
        return data.session.status(sessionID) === "running" ? { type: "busy" } : { type: "idle" }
      },
      permission(_sessionID) {
        return []
      },
      question(_sessionID) {
        return []
      },
    },
    part(_messageID) {
      return []
    },
    lsp() {
      return []
    },
    mcp() {
      return (data.location.mcp.server.list() ?? [])
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((item) =>
          item.status.status === "pending"
            ? []
            : [
                {
                  name: item.name,
                  status: item.status.status,
                  error: item.status.status === "failed" ? item.status.error : undefined,
                },
              ],
        )
    },
  }
}

function appApi(version: string): TuiPluginApi["app"] {
  return {
    get version() {
      return version
    },
  }
}

const unsupportedClient = new Proxy(
  {},
  {
    get() {
      throw new Error("The legacy plugin client is not supported in V2")
    },
  },
) as TuiPluginApi["client"]

export function createTuiApiAdapters(input: Input): Omit<TuiPluginApi, "lifecycle"> {
  return {
    app: appApi(input.version),
    attention: input.attention,
    // Keep deprecated `api.command` working for v1 plugins; remove in v2.
    command: createCommandShim(input.keymap, input.dialog, input.tuiConfig.keybinds),
    keys: {
      formatSequence(parts) {
        return Keymap.formatKeySequence(parts, input.tuiConfig)
      },
      formatBindings(bindings) {
        return Keymap.formatKeyBindings(bindings, input.tuiConfig)
      },
    },
    keymap: input.keymap,
    mode: {
      current() {
        return Keymap.getOpencodeModeStack(input.keymap).current()
      },
      push(mode) {
        return Keymap.getOpencodeModeStack(input.keymap).push(mode)
      },
    },
    route: {
      register(list) {
        return input.routes.register(list)
      },
      navigate(name, params) {
        routeNavigate(input.route, name, params)
      },
      get current() {
        return routeCurrent(input.route)
      },
    },
    ui: {
      Dialog(props) {
        return (
          <DialogUI size={props.size} onClose={props.onClose}>
            {props.children}
          </DialogUI>
        )
      },
      DialogAlert(props) {
        return <DialogAlert {...props} />
      },
      DialogConfirm(props) {
        return <DialogConfirm {...props} />
      },
      DialogPrompt(props) {
        return <DialogPrompt {...props} description={props.description} />
      },
      DialogSelect(props) {
        return (
          <DialogSelect
            title={props.title}
            placeholder={props.placeholder}
            options={props.options.map(mapOption)}
            flat={props.flat}
            onMove={mapOptionCb(props.onMove)}
            onFilter={props.onFilter}
            onSelect={mapOptionCb(props.onSelect)}
            skipFilter={props.skipFilter}
            current={props.current}
          />
        )
      },
      Slot<Name extends string>(props: TuiSlotProps<Name>) {
        return <input.Slot {...props} />
      },
      Prompt(props) {
        return (
          <Prompt
            sessionID={props.sessionID}
            visible={props.visible}
            disabled={props.disabled}
            onSubmit={props.onSubmit}
            ref={props.ref}
            hint={props.hint}
            right={props.right}
            showPlaceholder={props.showPlaceholder}
            placeholders={props.placeholders}
          />
        )
      },
      toast(inputToast) {
        input.toast.show({
          title: inputToast.title,
          message: inputToast.message,
          variant: inputToast.variant ?? "info",
          duration: inputToast.duration,
        })
      },
      dialog: {
        replace(render, onClose) {
          input.dialog.replace(render, onClose)
        },
        clear() {
          input.dialog.clear()
        },
        setSize(size) {
          input.dialog.setSize(size)
        },
        get size() {
          return input.dialog.size
        },
        get depth() {
          return input.dialog.stack.length
        },
        get open() {
          return input.dialog.stack.length > 0
        },
      },
    },
    get tuiConfig() {
      return input.tuiConfig
    },
    kv: {
      get(_key, fallback) {
        if (fallback === undefined) throw new Error("Persistent TUI KV storage is not supported")
        return fallback
      },
      set() {},
      ready: true,
    },
    state: stateApi(input.project, input.data),
    client: unsupportedClient,
    event: input.event,
    renderer: input.renderer,
    slots: {
      register() {
        throw new Error("slots.register is only available in plugin context")
      },
    },
    plugins: {
      list() {
        return []
      },
      async activate() {
        return false
      },
      async deactivate() {
        return false
      },
      async add() {
        return false
      },
      async install() {
        return {
          ok: false,
          message: "plugins.install is only available in plugin context",
        }
      },
    },
    theme: {
      get current() {
        return input.theme.theme
      },
      get selected() {
        return input.theme.selected
      },
      has(name) {
        return input.theme.has(name)
      },
      set(name) {
        return input.theme.set(name)
      },
      async install(_jsonPath) {
        throw new Error("theme.install is only available in plugin context")
      },
      mode() {
        return input.theme.mode()
      },
      get ready() {
        return input.theme.ready
      },
    },
  }
}
