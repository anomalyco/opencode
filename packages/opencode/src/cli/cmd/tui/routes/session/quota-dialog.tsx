import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useCommandDialog } from "../../component/dialog-command"
import { SplitBorder } from "../../component/border"
import {
  fetchUsage,
  QUOTA_PROVIDER_ORDER,
  type QuotaGroup,
  type QuotaMode,
  type QuotaProviderID,
  type QuotaStatus,
} from "../../util/quota-usage"

type ProviderStatus = "loading" | QuotaStatus
type Tab = QuotaProviderID | "none"

type ProviderState = {
  status: ProviderStatus
  message: string
  mode: QuotaMode
  groups: QuotaGroup[]
}

const TAB_LABEL: Record<QuotaProviderID, string> = {
  antigravity: "Antigravity",
  "gemini-cli": "Gemini CLI",
  "qwen-cli": "Qwen CLI",
  claude: "Claude",
  "nano-gpt": "NanoGPT",
  codex: "Codex",
}

function renderProgressBar(percent: number, width = 12) {
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return "▰".repeat(filled) + "▱".repeat(empty)
}

function provider(mode: QuotaMode): ProviderState {
  return {
    status: "loading",
    message: "",
    mode,
    groups: [],
  }
}

export function QuotaDialog(props: { onClose: () => void }) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const sdk = useSDK()
  const command = useCommandDialog()

  onMount(() => {
    command.keybinds(false)
  })

  onCleanup(() => {
    command.keybinds(true)
  })

  const [activeTab, setActiveTab] = createSignal<Tab>("none")

  const [providers, setProviders] = createStore<Record<QuotaProviderID, ProviderState>>({
    antigravity: provider("count_and_percent"),
    "gemini-cli": provider("count_and_percent"),
    "qwen-cli": provider("count_and_percent"),
    claude: provider("percent_only"),
    "nano-gpt": provider("count_and_percent"),
    codex: provider("percent_only"),
  })

  const [store, setStore] = createStore({
    selected: 0,
  })

  const tabs = createMemo(() => {
    return QUOTA_PROVIDER_ORDER.filter((providerID) => {
      const status = providers[providerID].status
      return status === "success" || status === "error"
    })
  })

  const loading = createMemo(() => {
    return QUOTA_PROVIDER_ORDER.some((providerID) => providers[providerID].status === "loading")
  })

  createEffect(() => {
    const available = tabs()
    const current = activeTab()
    if (available.length === 0) {
      if (current !== "none") setActiveTab("none")
      return
    }
    if (current === "none") {
      setActiveTab(available[0])
      return
    }
    if (!available.includes(current as QuotaProviderID)) {
      setActiveTab(available[0])
    }
  })

  const currentProvider = createMemo(() => {
    const tab = activeTab()
    if (tab === "none") return
    return providers[tab]
  })

  const currentStatus = createMemo(() => {
    if (activeTab() === "none") {
      if (loading()) return "loading"
      return "not_configured"
    }
    return currentProvider()?.status ?? "not_configured"
  })

  const options = createMemo(() => {
    const status = currentStatus()
    if (status === "error") return { retry: "Retry", close: "Close" }
    if (status === "loading") return { close: "Close" }
    if (status === "not_configured" || status === "not_authenticated") return { close: "Close" }
    return { refresh: "Refresh", close: "Close" }
  })

  const keys = createMemo(() => Object.keys(options()) as (keyof ReturnType<typeof options>)[])

  const tabHint = createMemo(() => {
    const count = tabs().length
    if (count === 0) return "tab"
    return `tab/1-${count}`
  })

  createEffect(() => {
    if (store.selected < keys().length) return
    setStore("selected", 0)
  })

  async function refreshUsage() {
    QUOTA_PROVIDER_ORDER.forEach((providerID) => {
      setProviders(providerID, "status", "loading")
      setProviders(providerID, "message", "")
    })

    const usage = await fetchUsage(sdk.client)
    QUOTA_PROVIDER_ORDER.forEach((providerID) => {
      const item = usage[providerID]
      setProviders(providerID, {
        status: item.status,
        message: item.message ?? "",
        mode: item.mode,
        groups: item.groups,
      })
    })
  }

  onMount(() => {
    void refreshUsage()
  })

  function handleSelect(option: string) {
    if (option === "close") {
      props.onClose()
      return
    }
    if (option === "refresh" || option === "retry") {
      void refreshUsage()
    }
  }

  function switchTab(tab: QuotaProviderID) {
    setActiveTab(tab)
    setStore("selected", 0)
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      const available = tabs()
      if (!available.length) return
      const current = activeTab()
      const index = current === "none" ? -1 : available.indexOf(current as QuotaProviderID)
      const next = (index + 1) % available.length
      switchTab(available[next])
      return
    }

    const index = Number(evt.name)
    if (Number.isInteger(index) && String(index) === evt.name && index >= 1) {
      evt.preventDefault()
      const tab = tabs()[index - 1]
      if (tab) switchTab(tab)
      return
    }

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const next = (store.selected - 1 + keys().length) % keys().length
      setStore("selected", next)
      return
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const next = (store.selected + 1) % keys().length
      setStore("selected", next)
      return
    }

    if (evt.name === "return") {
      evt.preventDefault()
      handleSelect(keys()[store.selected])
      return
    }

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      props.onClose()
    }
  })

  const barColor = (percent: number) => {
    if (percent > 70) return theme.success
    if (percent > 30) return theme.warning
    return theme.error
  }

  const currentQuotas = createMemo(() => currentProvider()?.groups ?? [])

  const currentMode = createMemo<QuotaMode>(() => currentProvider()?.mode ?? "count_and_percent")

  const currentError = createMemo(() => currentProvider()?.message || "Failed to fetch quota data")

  const maxDisplayLen = createMemo(() => {
    const displays = currentQuotas().map((item) => item.display)
    if (!displays.length) return 7
    return Math.max(...displays.map((item) => item.length), 7)
  })

  const emptyHint = createMemo(() => {
    const tab = activeTab()
    if (tab === "antigravity") return "(No Antigravity credentials configured on proxy)"
    if (tab === "gemini-cli") return "(No Gemini CLI credentials configured on proxy)"
    if (tab === "qwen-cli") return "(No Qwen CLI usage available from proxy)"
    if (tab === "nano-gpt") return "(No NanoGPT subscription usage available)"
    if (tab === "codex") return "(No Codex usage windows available)"
    return ""
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.primary}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.primary}>{"◈"}</text>
            <text fg={theme.text}>Quota Usage</text>
          </box>
          <box flexDirection="row" gap={1}>
            <For each={tabs()}>
              {(tab, index) => (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={activeTab() === tab ? theme.primary : theme.backgroundMenu}
                >
                  <text fg={activeTab() === tab ? theme.selectedListItemText : theme.textMuted}>
                    [{index() + 1}] {TAB_LABEL[tab]}
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>

        <Show when={activeTab() === "none" && !loading()}>
          <box paddingLeft={1} gap={1}>
            <text fg={theme.textMuted}>{"  No quota providers configured."}</text>
            <text fg={theme.text}>{""}</text>
            <text fg={theme.textMuted}>{"  Configure a provider in opencode.json or use /auth"}</text>
          </box>
        </Show>

        <Show when={activeTab() === "none" && loading()}>
          <box paddingLeft={1}>
            <text fg={theme.textMuted}>{"  ◐ Refreshing quota data..."}</text>
          </box>
        </Show>

        <Show when={activeTab() !== "none"}>
          <Switch>
            <Match when={currentStatus() === "loading"}>
              <box paddingLeft={1}>
                <text fg={theme.textMuted}>{"  ◐ Refreshing quota data..."}</text>
              </box>
            </Match>

            <Match when={currentStatus() === "error"}>
              <box paddingLeft={1}>
                <text fg={theme.error}>
                  {"  ✗ "}
                  {currentError()}
                </text>
              </box>
            </Match>

            <Match when={currentStatus() === "success"}>
              <box paddingLeft={1} gap={0} minHeight={3}>
                <Show when={currentQuotas().length === 0}>
                  <text fg={theme.textMuted}>{"  No quota data available"}</text>
                  <Show when={emptyHint()}>
                    <text fg={theme.textMuted}>{"  " + emptyHint()}</text>
                  </Show>
                </Show>
                <For each={currentQuotas()}>
                  {(quota) => (
                    <text fg={theme.text}>
                      {"  "}
                      <span style={{ fg: theme.textMuted }}>{quota.display.padStart(maxDisplayLen())}</span>
                      {"  "}
                      <span style={{ fg: barColor(quota.remaining) }}>{renderProgressBar(quota.remaining)}</span>
                      {"  "}
                      {String(quota.remaining).padStart(3)}%
                      <Show when={currentMode() === "count_and_percent"}>
                        {"  "}
                        <span style={{ fg: theme.textMuted }}>
                          {String(quota.used).padStart(4)}/{quota.max}
                        </span>
                      </Show>
                      <Show when={quota.resetTime}>
                        <span style={{ fg: theme.textMuted }}>
                          {currentMode() === "count_and_percent" ? "   resets " : "     resets "}
                          {quota.resetTime}
                        </span>
                      </Show>
                    </text>
                  )}
                </For>
              </box>
            </Match>

            <Match when={true}>
              <box paddingLeft={1}>
                <text fg={theme.textMuted}>{"  Provider quota unavailable."}</text>
              </box>
            </Match>
          </Switch>
        </Show>
      </box>

      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={1}>
          <For each={keys()}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === keys()[store.selected] ? theme.primary : theme.backgroundMenu}
              >
                <text fg={option === keys()[store.selected] ? theme.selectedListItemText : theme.textMuted}>
                  {options()[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            {tabHint()} <span style={{ fg: theme.textMuted }}>switch</span>
          </text>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )
}
