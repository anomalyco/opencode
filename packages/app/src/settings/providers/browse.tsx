import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowseBridge, BrowseInstallFailure } from "@/runtime/platform/platform"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import "@/settings/settings.css"
import "@/shell/search-list.css"
import {
  browseCardPolling,
  browseCardView,
  createBrowseCardState,
  transitionBrowseCard,
  type BrowseCardEffect,
  type BrowseCardEvent,
  type BrowseIncomplete,
} from "./browse-machine"

export const BROWSE_STORE_URL = "https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg"

const POLL_MS = 2000

const failureLabels = {
  start: "settings.extensions.browse.failed.start",
  download: "settings.extensions.browse.failed.download",
  timeout: "settings.extensions.browse.failed.timeout",
  installer: "settings.extensions.browse.failed.installer",
} as const satisfies Record<BrowseInstallFailure["reason"], string>

const incompleteLabels = {
  config: "settings.extensions.browse.incomplete.config",
  extension: "settings.extensions.browse.incomplete.extension",
  pairing: "settings.extensions.browse.incomplete.pairing",
  update: "settings.extensions.browse.incomplete.update",
} as const satisfies Record<BrowseIncomplete, string>

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

  const install = () => dispatch({ type: "install.requested" })

  const store = () => platform.openExternal(`${BROWSE_STORE_URL}?utm_source=opencode-desktop&utm_campaign=settings`)

  const failure = () => {
    const current = view()

    return current.phase === "absent" || current.phase === "incomplete" ? current.failure : undefined
  }

  const detail = () => {
    const current = view()
    const failed = failure()

    if (failed) return failed.detail ?? language.t(failureLabels[failed.reason])

    switch (current.phase) {
      case "checking":
        return language.t("settings.extensions.browse.description")
      case "unavailable":
        return language.t("settings.extensions.browse.unavailable")
      case "absent":
        return language.t("settings.extensions.browse.description")
      case "installing":
        return language.t(
          current.store ? "settings.extensions.browse.waitingExtension" : "settings.extensions.browse.installing",
        )
      case "incomplete":
        return language.t(incompleteLabels[current.reason])
      case "ready":
        return language.t(
          current.connected ? "settings.extensions.browse.connected" : "settings.extensions.browse.installed",
        )
    }
  }

  const error = () => !!failure()

  const connected = () => {
    const current = view()

    return current.phase === "ready" && current.connected
  }

  const showStore = () => {
    const current = view()

    return (current.phase === "installing" || current.phase === "incomplete") && current.store
  }

  return (
    <div class="settings-section settings-browse">
      <span class="settings-extension-heading text-13-medium">{language.t("settings.extensions.browse.heading")}</span>
      <SettingsList variant="catalog">
        <div class="settings-extension-row settings-browse-row" data-phase={view().phase}>
          <div class="settings-extension-lead">
            <Icon name="outline-globe" class="text-v2-icon-icon-muted shrink-0" />
            <div class="settings-browse-text">
              <span class="settings-extension-name">{language.t("settings.extensions.browse.name")}</span>
              <span
                class="settings-browse-detail text-13-regular"
                data-error={error() ? "" : undefined}
                role={error() ? "alert" : undefined}
              >
                {detail()}
              </span>
            </div>
          </div>
          <div class="settings-extension-trailing settings-browse-trailing">
            <Switch>
              <Match when={view().phase === "checking"}>
                <Loader aria-label={language.t("common.loading")} />
              </Match>
              <Match when={view().phase === "unavailable"}>
                <Button size="small" variant="ghost-muted" onClick={() => dispatch({ type: "refresh.requested" })}>
                  {language.t("common.retry")}
                </Button>
              </Match>
              <Match when={view().phase === "absent"}>
                <Button size="small" variant="neutral" onClick={install}>
                  {language.t(error() ? "common.retry" : "settings.extensions.browse.install")}
                </Button>
              </Match>
              <Match when={view().phase === "installing"}>
                <Show when={showStore()}>
                  <Button size="small" variant="neutral" onClick={store}>
                    {language.t("settings.extensions.browse.openStore")}
                  </Button>
                </Show>
                <Loader aria-label={language.t("settings.extensions.browse.installing")} />
              </Match>
              <Match when={view().phase === "incomplete"}>
                <Show when={showStore()}>
                  <Button size="small" variant="ghost-muted" onClick={store}>
                    {language.t("settings.extensions.browse.openStore")}
                  </Button>
                </Show>
                <Button size="small" variant="neutral" onClick={install}>
                  {language.t("settings.extensions.browse.finish")}
                </Button>
              </Match>
              <Match when={connected()}>
                <span class="settings-mcp-status">
                  <span class="mcp-status-dot" data-status="connected" aria-hidden="true" />
                </span>
              </Match>
            </Switch>
          </div>
        </div>
      </SettingsList>
    </div>
  )
}
