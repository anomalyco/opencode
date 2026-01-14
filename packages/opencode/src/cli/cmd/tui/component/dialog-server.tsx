import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme, selectedForeground } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { Clipboard } from "@/util/clipboard"
import { Show, createSignal, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import open from "open"

type Action = "toggle" | "copy" | "open" | "dismiss"

export function DialogServer(props: {
  password?: string
  passwordFromEnv?: boolean
  justStarted?: boolean
  onStartServer?: () => Promise<
    | {
        url: string
        password: string
        passwordFromEnv: boolean
      }
    | undefined
  >
  onStopServer?: () => Promise<void>
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const [copied, setCopied] = createSignal(false)
  const [flash, setFlash] = createSignal(false)
  const [localUrl, setLocalUrl] = createSignal<string>()
  const [localPassword, setLocalPassword] = createSignal(props.password)
  const [localPasswordFromEnv, setLocalPasswordFromEnv] = createSignal(props.passwordFromEnv)
  const [starting, setStarting] = createSignal(false)

  onMount(() => {
    dialog.setSize("large")
    if (props.justStarted) {
      setFlash(true)
      setTimeout(() => setFlash(false), 150)
      setTimeout(() => setFlash(true), 300)
      setTimeout(() => setFlash(false), 450)
    }
  })

  const url = createMemo(() => localUrl() ?? sync.data.server)
  const password = createMemo(() => localPassword())
  const passwordFromEnv = createMemo(() => localPasswordFromEnv())
  const running = createMemo(() => !!url())

  const actions = createMemo(() => {
    const result: Action[] = ["toggle"]
    if (password()) result.push("copy")
    if (running()) result.push("open")
    result.push("dismiss")
    return result
  })

  const [store, setStore] = createStore({
    active: "toggle" as Action,
  })

  const copyPassword = async () => {
    const pw = password()
    if (!pw) {
      toast.show({ message: "No password available", variant: "error" })
      return
    }
    await Clipboard.copy(pw)
      .then(() => {
        setCopied(true)
        toast.show({ message: "Password copied to clipboard", variant: "success" })
        if (running()) {
          setStore("active", "open")
        }
      })
      .catch(() => {
        toast.show({ message: "Failed to copy password", variant: "error" })
      })
  }

  const openBrowser = () => {
    const target = url()
    if (!target) return dialog.clear()
    open(target).catch(() => {})
    dialog.clear()
  }

  const startServer = async () => {
    if (!props.onStartServer || starting()) return
    setStarting(true)
    try {
      const result = await props.onStartServer()
      if (!result) return
      setLocalUrl(result.url)
      setLocalPassword(result.password)
      setLocalPasswordFromEnv(result.passwordFromEnv)
      sync.set("server", result.url)
      toast.show({ message: "Server started", variant: "success" })
      setFlash(true)
      setTimeout(() => setFlash(false), 150)
      setTimeout(() => setFlash(true), 300)
      setTimeout(() => setFlash(false), 450)
      // Auto-select copy password after starting
      setStore("active", "copy")
    } finally {
      setStarting(false)
    }
  }

  const stopServer = async () => {
    await props.onStopServer?.()
    setLocalUrl(undefined)
    setLocalPassword(undefined)
    setLocalPasswordFromEnv(undefined)
    sync.set("server", undefined)
    toast.show({ message: "Server stopped", variant: "success" })
    setStore("active", "toggle")
  }

  const toggleServer = () => {
    if (running()) stopServer()
    else startServer()
  }

  useKeyboard((evt) => {
    if (evt.name === "return") {
      if (store.active === "toggle") toggleServer()
      if (store.active === "copy") copyPassword()
      if (store.active === "open") openBrowser()
      if (store.active === "dismiss") dialog.clear()
    }
    if (evt.name === "tab" || evt.name === "right") {
      const list = actions()
      const idx = list.indexOf(store.active)
      const next = list[(idx + 1) % list.length]!
      setStore("active", next)
    }
    if (evt.name === "left") {
      const list = actions()
      const idx = list.indexOf(store.active)
      const next = list[(idx - 1 + list.length) % list.length]!
      setStore("active", next)
    }
  })

  const fg = selectedForeground(theme)

  const buttonBg = (action: Action) => {
    return store.active === action ? theme.primary : theme.backgroundElement
  }

  const buttonFg = (action: Action) => (store.active === action ? fg : theme.text)

  const toggleLabel = () => {
    if (starting()) return "Starting..."
    return running() ? "Stop server" : "Start server"
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Server
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show
        when={url()}
        fallback={
          <box gap={1}>
            <text fg={theme.textMuted}>Server not running</text>
            <box flexDirection="row" gap={2} marginTop={1}>
              <box paddingLeft={2} paddingRight={2} backgroundColor={buttonBg("toggle")} onMouseUp={toggleServer}>
                <text fg={buttonFg("toggle")}>{toggleLabel()}</text>
              </box>
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={buttonBg("dismiss")}
                onMouseUp={() => dialog.clear()}
              >
                <text fg={buttonFg("dismiss")}>Dismiss</text>
              </box>
            </box>
          </box>
        }
      >
        {(serverUrl) => (
          <box gap={1}>
            <text fg={flash() ? theme.backgroundPanel : theme.success}>Server running</text>
            <box>
              <text fg={theme.textMuted}>Address</text>
              <text fg={theme.text}>{serverUrl()}</text>
            </box>
            <box>
              <text fg={theme.textMuted}>Username</text>
              <text fg={theme.text}>opencode</text>
            </box>
            <box>
              <text fg={theme.textMuted}>Password</text>
              <text fg={passwordFromEnv() ? theme.text : theme.warning}>
                {passwordFromEnv() ? "from environment variable" : "randomly generated"}
              </text>
            </box>
            <box flexDirection="row" gap={2} marginTop={1}>
              <box paddingLeft={2} paddingRight={2} backgroundColor={buttonBg("toggle")} onMouseUp={toggleServer}>
                <text fg={buttonFg("toggle")}>{toggleLabel()}</text>
              </box>
              <Show when={password()}>
                <box paddingLeft={2} paddingRight={2} backgroundColor={buttonBg("copy")} onMouseUp={copyPassword}>
                  <text fg={buttonFg("copy")}>{copied() ? "Copied!" : "Copy password"}</text>
                </box>
              </Show>
              <box paddingLeft={2} paddingRight={2} backgroundColor={buttonBg("open")} onMouseUp={openBrowser}>
                <text fg={buttonFg("open")}>Open browser</text>
              </box>
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={buttonBg("dismiss")}
                onMouseUp={() => dialog.clear()}
              >
                <text fg={buttonFg("dismiss")}>Dismiss</text>
              </box>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}
