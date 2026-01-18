import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLocal } from "../context/local"
import { useDialog } from "../ui/dialog"
import { Show, createSignal, onMount, createMemo } from "solid-js"
import { Usage, type ProviderUsage, type RateWindow } from "@/usage"
import { Link } from "../ui/link"
import {
  requestCopilotDeviceCode,
  pollCopilotAccessToken,
  saveCopilotUsageToken,
} from "@/usage/providers/copilot-auth"

// Map OpenCode provider IDs to usage provider IDs
const PROVIDER_MAP: Record<string, string> = {
  "github-copilot": "github-copilot",
  "github-copilot-enterprise": "github-copilot",
  openai: "openai",
  anthropic: "anthropic",
  google: "antigravity",
  "google-vertex": "antigravity",
  opencode: "opencode",
}

// Providers that are pay-per-use with no rate limits
const UNLIMITED_PROVIDERS: Record<string, string> = {
  opencode: "OpenCode Zen",
}

export function DialogUsage() {
  const { theme } = useTheme()
  const local = useLocal()
  const dialog = useDialog()
  const [loading, setLoading] = createSignal(true)
  const [providers, setProviders] = createSignal<ProviderUsage[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [showRemaining, setShowRemaining] = createSignal(false)

  const currentProviderID = createMemo(() => {
    const model = local.model.current()
    if (!model) return null
    return PROVIDER_MAP[model.providerID] ?? model.providerID
  })

  const currentProvider = createMemo((): ProviderUsage | null => {
    const id = currentProviderID()
    if (!id) return null

    // First check if we have usage data for this provider
    const found = providers().find((p) => p.providerId === id)
    if (found) return found

    // If not found but it's an unlimited provider, create a synthetic entry
    if (UNLIMITED_PROVIDERS[id]) {
      return {
        providerId: id,
        providerLabel: UNLIMITED_PROVIDERS[id],
        status: "unlimited",
      }
    }

    return null
  })

  const refetchUsage = async () => {
    setLoading(true)
    setError(null)
    try {
      const snapshot = await Usage.fetch()
      setProviders(snapshot.providers)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      setShowRemaining((prev) => !prev)
    }
  })

  onMount(refetchUsage)

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>tab</span> toggle view | esc
        </text>
      </box>

      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading...</text>
      </Show>

      <Show when={error()}>
        <text fg={theme.error}>Error: {error()}</text>
      </Show>

      <Show when={!loading() && !error()}>
        <Show when={currentProvider()}>
          <CurrentProviderSection
            provider={currentProvider()!}
            showRemaining={showRemaining()}
            onAuthComplete={refetchUsage}
          />
        </Show>

        <Show when={!currentProvider()}>
          <text fg={theme.textMuted}>Usage not available for current provider</text>
        </Show>
      </Show>
    </box>
  )
}

function CurrentProviderSection(props: {
  provider: ProviderUsage
  showRemaining: boolean
  onAuthComplete: () => Promise<void>
}) {
  const { theme } = useTheme()
  const p = () => props.provider

  const isCopilotReauth = createMemo(() => p().providerId === "github-copilot" && p().error === "copilot_reauth_required")

  return (
    <box gap={1}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {p().providerLabel}
        </text>
        <Show when={p().plan}>
          <text fg={theme.textMuted}>({p().plan})</text>
        </Show>
      </box>

      <Show when={p().status === "error" && isCopilotReauth()}>
        <CopilotSetupPrompt onAuthComplete={props.onAuthComplete} />
      </Show>

      <Show when={p().status === "error" && !isCopilotReauth()}>
        <text fg={theme.error}>{p().error}</text>
      </Show>

      <Show when={p().status === "unsupported"}>
        <text fg={theme.textMuted}>{p().error ?? "Usage tracking not supported"}</text>
      </Show>

      <Show when={p().status === "unlimited"}>
        <box gap={0}>
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            Unlimited
          </text>
          <text fg={theme.textMuted}>No rate limits - pay per use</text>
        </box>
      </Show>

      <Show when={p().status === "ok"}>
        <Show when={p().primary}>
          <LargeRateBar window={p().primary!} showRemaining={props.showRemaining} />
        </Show>
        <Show when={p().secondary}>
          <LargeRateBar window={p().secondary!} showRemaining={props.showRemaining} />
        </Show>
        <Show when={p().tertiary}>
          <LargeRateBar window={p().tertiary!} showRemaining={props.showRemaining} />
        </Show>
        <Show when={p().accountEmail}>
          <text fg={theme.textMuted}>{p().accountEmail}</text>
        </Show>
      </Show>
    </box>
  )
}

function CopilotSetupPrompt(props: { onAuthComplete: () => Promise<void> }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [setting, setSetting] = createSignal(false)
  const [authData, setAuthData] = createSignal<{ url: string; code: string } | null>(null)
  const [authError, setAuthError] = createSignal<string | null>(null)

  useKeyboard((evt) => {
    if (setting()) return
    if (evt.name === "y") {
      evt.preventDefault()
      evt.stopPropagation()
      startCopilotAuth()
    }
    if (evt.name === "n") {
      evt.preventDefault()
      evt.stopPropagation()
      dialog.clear()
    }
  })

  async function startCopilotAuth() {
    setSetting(true)
    setAuthError(null)
    try {
      // Request device code using Copilot-specific client ID
      const deviceCode = await requestCopilotDeviceCode()

      setAuthData({
        url: deviceCode.verificationUri,
        code: deviceCode.userCode,
      })

      // Poll for access token
      const tokenResponse = await pollCopilotAccessToken({
        deviceCode: deviceCode.deviceCode,
        interval: deviceCode.interval,
        expiresIn: deviceCode.expiresIn,
      })

      // Save the token for future usage fetches
      await saveCopilotUsageToken({
        accessToken: tokenResponse.access_token,
        scope: tokenResponse.scope,
        createdAt: new Date().toISOString(),
      })

      // Refetch usage to show the new data
      await props.onAuthComplete()
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
      setSetting(false)
      setAuthData(null)
    }
  }

  return (
    <box gap={1}>
      <Show when={!setting()}>
        <text fg={theme.warning} wrapMode="word">
          Usage tracking requires GitHub authentication with Copilot permissions.
        </text>
        <text fg={theme.text} wrapMode="word">
          Would you like to set up Copilot usage tracking now?
        </text>
        <box flexDirection="row" gap={2}>
          <text>
            <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>y</span>
            <span style={{ fg: theme.textMuted }}> yes</span>
          </text>
          <text>
            <span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}>n</span>
            <span style={{ fg: theme.textMuted }}> no</span>
          </text>
        </box>
      </Show>

      <Show when={setting() && !authData() && !authError()}>
        <text fg={theme.textMuted}>Starting GitHub authentication...</text>
      </Show>

      <Show when={authError()}>
        <text fg={theme.error}>Error: {authError()}</text>
      </Show>

      <Show when={authData()}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Login with GitHub
        </text>
        <Link href={authData()!.url} fg={theme.primary} />
        <text fg={theme.text}>
          Enter code: <span style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>{authData()!.code}</span>
        </text>
        <text fg={theme.textMuted}>Waiting for authorization...</text>
      </Show>
    </box>
  )
}

function LargeRateBar(props: { window: RateWindow; showRemaining: boolean }) {
  const { theme } = useTheme()
  const w = () => props.window

  const barWidth = 50

  // When showing remaining, we show remaining % as filled (green = more remaining = good)
  // When showing used, we show used % as filled (green = less used = good)
  const displayPercent = createMemo(() => {
    const used = Math.min(100, Math.max(0, w().usedPercent))
    return props.showRemaining ? 100 - used : used
  })

  const filledWidth = createMemo(() => Math.round((displayPercent() / 100) * barWidth))
  const emptyWidth = createMemo(() => barWidth - filledWidth())

  const displayPct = createMemo(() => Math.round(displayPercent()))
  const label = createMemo(() => (props.showRemaining ? "remaining" : "used"))

  const barColor = createMemo(() => {
    const pct = w().usedPercent
    // Color is always based on usage (not remaining)
    if (pct >= 90) return theme.error
    if (pct >= 75) return theme.warning
    return theme.success
  })

  const resetText = createMemo(() => {
    if (!w().resetsAt) return null
    const resetDate = new Date(w().resetsAt!)
    if (Number.isNaN(resetDate.getTime())) return null
    const now = new Date()
    const diffMs = resetDate.getTime() - now.getTime()
    if (diffMs <= 0) return "Resets soon"

    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `Resets in ${diffMins}m`
    if (diffHours < 24) return `Resets in ${diffHours}h ${diffMins % 60}m`
    if (diffDays === 1) return `Resets tomorrow`
    return `Resets in ${diffDays} days`
  })

  return (
    <box gap={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>{w().label}</text>
        <text fg={theme.textMuted}>
          {displayPct()}% {label()}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text>
          <span style={{ fg: barColor() }}>{"█".repeat(filledWidth())}</span>
          <span style={{ fg: theme.textMuted }}>{"░".repeat(emptyWidth())}</span>
        </text>
      </box>
      <Show when={resetText()}>
        <text fg={theme.textMuted}>{resetText()}</text>
      </Show>
    </box>
  )
}
