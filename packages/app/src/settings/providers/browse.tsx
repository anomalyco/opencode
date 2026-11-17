import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Spinner } from "@opencode/ui/spinner"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowseBridge } from "@/runtime/platform/platform"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import "@/settings/settings.css"
import "@/shell/search-list.css"
import {
  browseCardPolling,
  browseCardView,
  createBrowseCardState,
  transitionBrowseCard,
  type BrowseCardEffect,
  type BrowseCardEvent,
  type BrowseSetupStep,
} from "./browse-machine"

export const BROWSE_STORE_URL = "https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg"

const BROWSE_PAIRING_URL = "https://github.com/anomalyco/browse#pairing"

const POLL_MS = 2000

const stepActions = {
  install: "settings.extensions.browse.install",
  opencode: "settings.extensions.browse.connect",
  browser: "settings.extensions.browse.connect",
  update: "settings.extensions.browse.update",
} as const satisfies Record<BrowseSetupStep, string>

const stepDetails = {
  install: "settings.extensions.browse.description",
  opencode: "settings.extensions.browse.notConnectedOpencode",
  browser: "settings.extensions.browse.notConnectedBrowser",
  update: "settings.extensions.browse.needsUpdate",
} as const satisfies Record<BrowseSetupStep, string>

type ActionLabel = (typeof stepActions)[BrowseSetupStep] | "common.retry"

type DetailLabel =
  | (typeof stepDetails)[BrowseSetupStep]
  | "settings.extensions.browse.failed"
  | "settings.extensions.browse.stalled"

/** Installs and connects browse on this computer. Only the desktop's own server runs agents here. */
export const SettingsBrowse: Component<{ bridge: BrowseBridge; onInstalled: () => void }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const initial = createBrowseCardState()
  const [state, setState] = createSignal(initial.state)

  const dispatch = (event: BrowseCardEvent) => {
    const next = transitionBrowseCard(state(), event)

    if (next.state !== state()) setState(next.state)
    next.effects.forEach(perform)
  }

  const perform = (effect: BrowseCardEffect) => {
    if (effect.type === "sync-mcps") return props.onInstalled()

    const attempt = effect.attempt

    if (effect.type === "read")
      return void props.bridge.status().then(
        (browse) => dispatch({ type: "read.succeeded", attempt, browse }),
        () => dispatch({ type: "read.failed", attempt }),
      )

    void props.bridge.install().then(
      () => dispatch({ type: "install.started", attempt }),
      () => dispatch({ type: "install.failed", attempt }),
    )
  }

  initial.effects.forEach(perform)
  onCleanup(() => dispatch({ type: "disposed" }))

  createEffect(() => {
    if (!browseCardPolling(state())) return

    const timer = setInterval(() => dispatch({ type: "refresh.requested" }), POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  // Someone may finish a step outside the app (adding the extension, pairing), so coming back re-reads.
  const onFocus = () => dispatch({ type: "refresh.requested" })
  window.addEventListener("focus", onFocus)
  onCleanup(() => window.removeEventListener("focus", onFocus))

  const view = createMemo(() => browseCardView(state()))

  // Offered until set up: a browse already set up when the page opened is listed with the MCPs instead, while one set up
  // here stays so the row shows it worked. A status that can't be read hides the row: it's only a recommendation.
  const [offered, setOffered] = createSignal<boolean>()

  createEffect(() => {
    const phase = view().phase

    if (offered() === undefined && phase !== "checking") setOffered(phase !== "ready" && phase !== "unavailable")
  })

  // The busy button keeps the label of the one pressed, so the row doesn't shift while the installer runs.
  // While the installer runs, the row keeps the button's label (for its width) and the line it showed when pressed. An
  // install already running when the page opened falls back to the description.
  const [pressed, setPressed] = createSignal<{ action: ActionLabel; detail: DetailLabel }>({
    action: "settings.extensions.browse.install",
    detail: "settings.extensions.browse.description",
  })

  const install = (action: ActionLabel, detail: DetailLabel) => {
    setPressed({ action, detail })
    dispatch({ type: "install.requested" })
  }

  const [errorOpen, setErrorOpen] = createSignal(false)
  // The output last copied, so a new failure shows Copy again.
  const [copied, setCopied] = createSignal<string>()

  // A memo, so the status reads that poll or follow window focus don't count as a new failure.
  const output = createMemo(() => {
    const current = view()

    return current.phase === "failed" ? (current.failure.output ?? current.failure.detail) : undefined
  })

  // A new failure starts closed.
  createEffect(() => {
    output()
    setErrorOpen(false)
  })

  const copy = (text: string) =>
    void (platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text)).then(
      () => setCopied(text),
      (error) =>
        showToast({
          variant: "error",
          title: language.t("settings.extensions.browse.copyFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
    )

  const store = () => platform.openExternal(`${BROWSE_STORE_URL}?utm_source=opencode-desktop&utm_campaign=settings`)

  const detail = () => {
    const current = view()

    switch (current.phase) {
      case "checking":
      case "unavailable":
        return language.t("settings.extensions.browse.description")
      case "setup":
        return language.t(stepDetails[current.step])
      case "installing":
        return language.t(current.store ? "settings.extensions.browse.waitingExtension" : pressed().detail)
      case "stalled":
        return language.t("settings.extensions.browse.stalled")
      case "failed":
        return language.t("settings.extensions.browse.failed")
      case "ready":
        return language.t("settings.extensions.browse.connected")
    }
  }

  const step = () => {
    const current = view()

    return current.phase === "setup" ? current.step : undefined
  }

  const waiting = () => {
    const current = view()

    return current.phase === "installing" && current.store
  }

  return (
    <Show when={offered()}>
      <div class="settings-section settings-extensions-featured">
        <span class="settings-extension-heading text-13-medium">{language.t("settings.extensions.featured")}</span>
        <div class="settings-feature-card" data-phase={view().phase}>
          <div class="settings-feature-card-text">
            <span class="settings-feature-card-name">
              <span class="settings-extension-name">{language.t("settings.extensions.browse.name")}</span>
              <Show when={view().phase === "ready"}>
                <span class="mcp-status-dot" data-status="connected" aria-hidden="true" />
              </Show>
            </span>
            <span
              class="settings-feature-card-detail text-13-regular"
              data-error={view().phase === "failed" ? "" : undefined}
              role={view().phase === "failed" ? "alert" : undefined}
            >
              {detail()}
            </span>
          </div>
          <Show when={view().phase !== "ready"}>
            <div class="settings-feature-card-actions">
              <Switch>
                <Match when={step()}>
                  {(current) => (
                    <Button
                      size="small"
                      variant="neutral"
                      onClick={() => install(stepActions[current()], stepDetails[current()])}
                    >
                      {language.t(stepActions[current()])}
                    </Button>
                  )}
                </Match>
                <Match when={view().phase === "stalled"}>
                  <Button size="small" variant="ghost-muted" onClick={() => platform.openExternal(BROWSE_PAIRING_URL)}>
                    {language.t("settings.extensions.browse.pairManually")}
                  </Button>
                  <Button
                    size="small"
                    variant="neutral"
                    onClick={() => install("common.retry", "settings.extensions.browse.stalled")}
                  >
                    {language.t("common.retry")}
                  </Button>
                </Match>
                <Match when={view().phase === "failed"}>
                  <Show when={output()}>
                    <Button
                      size="small"
                      variant="ghost-muted"
                      aria-expanded={errorOpen()}
                      aria-controls="settings-browse-error"
                      onClick={() => setErrorOpen((open) => !open)}
                    >
                      {language.t(
                        errorOpen() ? "settings.extensions.browse.hideError" : "settings.extensions.browse.seeError",
                      )}
                    </Button>
                  </Show>
                  <Button
                    size="small"
                    variant="neutral"
                    onClick={() => install("common.retry", "settings.extensions.browse.failed")}
                  >
                    {language.t("common.retry")}
                  </Button>
                </Match>
                <Match when={view().phase === "installing"}>
                  <Show when={waiting()}>
                    <Button size="small" variant="ghost-muted" onClick={store}>
                      {language.t("settings.extensions.browse.openAgain")}
                    </Button>
                  </Show>
                  <Button
                    size="small"
                    variant="loading"
                    class="settings-feature-card-busy"
                    aria-busy="true"
                    aria-label={language.t("settings.extensions.browse.installing")}
                  >
                    <span class="settings-feature-card-busy-label">{language.t(pressed().action)}</span>
                    <Spinner width={16} />
                  </Button>
                </Match>
              </Switch>
            </div>
          </Show>
          <Show when={errorOpen() && output()}>
            {(text) => (
              <div class="settings-feature-card-error" id="settings-browse-error">
                <pre class="settings-feature-card-error-output">{text()}</pre>
                <Button
                  size="small"
                  variant="ghost-muted"
                  class="settings-feature-card-error-copy"
                  icon={copied() === text() ? "check" : "copy"}
                  onClick={() => copy(text())}
                >
                  {language.t(copied() === text() ? "common.copied" : "settings.extensions.browse.copyError")}
                </Button>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  )
}
