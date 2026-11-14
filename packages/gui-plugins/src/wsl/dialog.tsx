import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { Loader } from "@opencode/ui/loader"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { TextInput } from "@opencode/ui/text-input"
import { batch, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { showToast } from "@opencode/ui/toast"
import { createKeyed, usePlugin, type Context, type IpcClient } from "@opencode/plugin/gui"
import type { Wsl, WslServersState } from "./contract"
import {
  createWslDialogState,
  transitionWslDialog,
  type WslDialogAction,
  type WslDialogEffect,
  type WslDialogEvent,
} from "./dialog-machine"
import { useWslAddServerProbes } from "./probes"
import { addServerViewModel, type AddServerText } from "./model"

export { default as css } from "./dialog.css?inline"

function isWslRuntimeMissing(error: string | null | undefined) {
  if (!error) return true

  return /WSL is not installed|not been installed|wsl(?:\.exe)? --install/i.test(error)
}

function translate(language: Context, value: AddServerText) {
  if (value.params) return language.t(value.key, value.params)

  return language.t(value.key)
}

interface DialogWslServerProps {
  api: IpcClient<(typeof Wsl)["spec"]> | undefined
  state: WslServersState | undefined
}

export function DialogAddWslServer(props: DialogWslServerProps) {
  const language = usePlugin()
  const controller = useWslAddServerController(props)
  const model = controller.model
  const primaryButton = () => model().primaryButton

  const primaryButtonStyle = () => {
    const width = primaryButton().width

    if (!width) return undefined

    return { width }
  }

  return (
    <Show
      when={controller.state()}
      fallback={
        <Dialog fit class="settings-wsl-dialog">
          <div class="settings-wsl-loading">
            <Loader />
          </div>
        </Dialog>
      }
    >
      <Show
        when={model().runtimeState === "ready"}
        fallback={
          <Show
            when={model().runtimeState === "checking" || model().runtimeState === "loading"}
            fallback={
              <DialogWslSetup
                state={model().runtimeState}
                error={controller.runtimeError()}
                installable={isWslRuntimeMissing(controller.runtimeError())}
                busy={model().busy}
                onInstall={controller.installWsl}
              />
            }
          >
            <Dialog fit class="settings-wsl-dialog">
              <div class="settings-wsl-loading">
                <Loader />
              </div>
            </Dialog>
          </Show>
        }
      >
        <Dialog fit class="settings-wsl-dialog">
          <DialogHeader hideClose={true}>
            <DialogTitle>
              {model().view === "main" ? language.t("server.add") : language.t("onboarding.installDistro")}
            </DialogTitle>
          </DialogHeader>
          <Divider />
          <Show
            when={model().view === "main"}
            fallback={
              <>
                <DialogBody class="settings-wsl-dialog-body settings-wsl-catalog-picker">
                  <TextInput
                    class="settings-wsl-catalog-search"
                    appearance="large"
                    placeholder={language.t("onboarding.searchDistros")}
                    value={model().catalogSearch}
                    disabled={model().busy}
                    onInput={(event) => controller.setCatalogSearch(event.currentTarget.value)}
                  />
                  <div class="settings-wsl-catalog-list">
                    <RadioGroup
                      hideLabel
                      class="settings-wsl-distro-group"
                      label={language.t("onboarding.installDistro")}
                      value={model().catalogTarget ?? undefined}
                      onChange={controller.setCatalogTarget}
                      disabled={model().busy}
                    >
                      <For each={model().filteredInstallableDistros}>
                        {(item) => (
                          <RadioItem
                            class="settings-wsl-distro-row settings-wsl-catalog-row"
                            value={item.name}
                            disabled={model().busy}
                            label={<span class="settings-wsl-distro-label">{item.label}</span>}
                          />
                        )}
                      </For>
                    </RadioGroup>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <Button variant="neutral" disabled={model().busy} onClick={controller.closeCatalog}>
                    {language.t("common.cancel")}
                  </Button>
                  <Button
                    variant={model().installingCatalogDistro ? "loading" : "contrast"}
                    disabled={!model().installingCatalogDistro && (model().busy || !model().catalogTarget)}
                    style={{ width: "99px" }}
                    onClick={controller.installCatalogDistro}
                  >
                    <Show when={model().installingCatalogDistro} fallback={language.t("onboarding.installDistro")}>
                      <Loader />
                    </Show>
                  </Button>
                </DialogFooter>
              </>
            }
          >
            <DialogBody class="settings-wsl-dialog-body">
              <div class="settings-wsl-section-header">
                <span class="settings-wsl-section-title">{language.t("onboarding.installedDistros")}</span>
                <Button variant="ghost-muted" size="small" disabled={model().busy} onClick={controller.refreshDistros}>
                  {language.t("onboarding.checkAgain")}
                </Button>
              </div>

              <Show
                when={model().addableInstalledDistros.length > 0}
                fallback={
                  <div class="settings-wsl-distro-list">
                    <div class="settings-wsl-distro-empty">
                      {model().visibleInstalledDistros.length
                        ? language.t("onboarding.allDistrosAdded")
                        : language.t("onboarding.noDistros")}
                    </div>
                  </div>
                }
              >
                <div class="settings-wsl-distro-list">
                  <RadioGroup
                    hideLabel
                    class="settings-wsl-distro-group"
                    label={language.t("onboarding.installedDistros")}
                    value={model().selectedDistro ?? undefined}
                    onChange={controller.setSelectedDistro}
                    disabled={model().busy}
                  >
                    <For each={model().addableInstalledDistros}>
                      {(item) => {
                        const status = () => model().distroStatuses[item.name] ?? null

                        return (
                          <RadioItem
                            class={`settings-wsl-distro-row${item.version === 1 ? " settings-wsl-distro-row--unsupported" : ""}`}
                            value={item.name}
                            disabled={item.version === 1 || model().busy}
                            label={<span class="settings-wsl-distro-label">{item.name}</span>}
                            description={
                              <Show when={status()}>
                                {(value) => (
                                  <span class="settings-wsl-distro-status" data-tone={value().tone}>
                                    {translate(language, value().label)}
                                  </span>
                                )}
                              </Show>
                            }
                          />
                        )
                      }}
                    </For>
                  </RadioGroup>
                </div>
              </Show>

              <Show when={model().installableDistros.length > 0}>
                <button
                  type="button"
                  class="settings-wsl-catalog-card"
                  disabled={model().busy}
                  onClick={controller.openCatalog}
                >
                  <span class="settings-wsl-catalog-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.5564 10.4443V13.5554H4.22309C3.24087 13.5554 2.44531 13.5554 2.44531 13.5554V10.4443M11.112 5.99989L8.00087 9.111L4.88976 5.99989M8.00087 9.111L8.00087 2.44434"
                        stroke="currentColor"
                      />
                    </svg>
                  </span>
                  <span class="settings-wsl-catalog-copy">
                    <span class="settings-wsl-catalog-title">{language.t("onboarding.needAnotherDistro")}</span>
                    <span class="settings-wsl-catalog-description">
                      {language.t("onboarding.needAnotherDistroHint")}
                    </span>
                  </span>
                  <span class="settings-wsl-catalog-chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6 12L10 8L6 4" stroke="currentColor" />
                    </svg>
                  </span>
                </button>
              </Show>
            </DialogBody>

            <DialogFooter>
              <Button variant="neutral" disabled={model().adding} onClick={controller.close}>
                {language.t("common.cancel")}
              </Button>
              <Button
                variant={primaryButton().loading ? "loading" : primaryButton().variant}
                disabled={!primaryButton().loading && primaryButton().disabled}
                style={primaryButtonStyle()}
                onClick={controller.runPrimary}
              >
                <Show when={primaryButton().loading} fallback={translate(language, primaryButton().label)}>
                  <Loader />
                </Show>
              </Button>
            </DialogFooter>
          </Show>
        </Dialog>
      </Show>
    </Show>
  )
}

function useWslAddServerController(props: DialogWslServerProps) {
  const language = usePlugin()
  const dialog = useDialog()

  // Without its main side, WSL reads as unavailable and every action fails, as when the desktop could not start it.
  const api = () => {
    const client = props.api

    if (!client) throw new Error(language.t("error.unavailable"))

    return client
  }

  // The machine state is immutable; each transition replaces it whole.
  const [dialogState, setDialogState] = createSignal(createWslDialogState())
  // Each running call's abort controller and timeout.
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const current = createMemo(() => (props.api ? props.state : unavailable(language.t("error.unavailable"))))

  const viewModel = (probingAddable: boolean) =>
    addServerViewModel({ state: current(), dialog: dialogState(), probingAddable })

  const baseModel = createMemo(() => viewModel(false))

  const probes = useWslAddServerProbes({
    state: current,
    api,
    available: () => !!props.api,
    view: () => baseModel().view,
    busy: () => baseModel().busy,
    selectedDistro: () => baseModel().selectedDistro,
    addableInstalledDistros: () => baseModel().addableInstalledDistros,
    onError: (error) => requestError(language, error),
  })

  const model = createMemo(() => viewModel(probes.probingAddable()))

  const dispatch = (event: WslDialogEvent) => {
    const previous = untrack(dialogState)
    const next = transitionWslDialog(previous, event)

    // One batch, so the probes see the dialog busy in the same update that clears their failures, and never start a
    // probe beside the call.
    batch(() => {
      if (next.state !== previous) setDialogState(next.state)
      next.effects.forEach(
        (effect) => void Promise.try(() => run(effect)).catch((cause) => requestError(language, cause)),
      )
    })
  }

  const run = (effect: WslDialogEffect) => {
    if (effect.type === "probes.reset") return probes.resetProbeFailure()

    if (effect.type === "dialog.close") return dialog.close()

    if (effect.type === "toast.error") return requestError(language, effect.cause)

    if (effect.type === "action.abort") {
      const running = runs.get(effect.attempt)

      runs.delete(effect.attempt)
      clearTimeout(running?.timer)
      running?.controller.abort()

      return
    }

    const attempt = effect.attempt
    const controller = new AbortController()

    const settle = (event: WslDialogEvent) => {
      if (runs.has(attempt)) dispatch(event)
    }

    const fail = (cause?: unknown) => settle({ type: "action.failed", attempt, cause })

    runs.set(attempt, { controller, timer: setTimeout(() => fail(), effect.timeoutMs) })
    void Promise.try(() => call(effect.action, AbortSignal.any([language.signal, controller.signal]))).then(
      () => settle({ type: "action.succeeded", attempt }),
      fail,
    )
  }

  const call = async (action: WslDialogAction, signal: AbortSignal) => {
    const client = api()

    if (action.kind === "install-wsl") return client.installWsl({ signal })

    if (action.kind === "refresh-distros") return client.refreshDistros({ signal })

    if (action.kind === "install-distro") return client.installDistro({ name: action.distro }, { signal })

    if (action.kind === "install-opencode") return client.installOpencode({ name: action.distro }, { signal })

    // The server shows up in main's state; the dialog needs only to know it was saved.
    await client.addServer({ distro: action.distro }, { signal })
  }

  // WSL's main side going away ends the call the dialog waits for; the dialog then shows WSL as unavailable.
  createKeyed(
    () => props.api,
    () => dispatch({ type: "availability.changed", available: true }),
    { otherwise: () => dispatch({ type: "availability.changed", available: false }) },
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    state: current,
    model,
    runtimeError: () => current()?.runtime?.error ?? null,
    setCatalogSearch: (value: string) => dispatch({ type: "catalog.search.changed", value }),
    setCatalogTarget: (distro: string) => dispatch({ type: "catalog.target.changed", distro }),
    setSelectedDistro: (distro: string) => dispatch({ type: "distro.selected", distro }),
    openCatalog: () =>
      dispatch({
        type: "catalog.opened",
        defaultTarget: model().installableDistros[0]?.name ?? null,
        busy: model().busy,
      }),
    closeCatalog: () => dispatch({ type: "catalog.closed", busy: model().busy }),
    refreshDistros: () => dispatch({ type: "distros.refresh.requested", busy: model().busy }),
    installCatalogDistro: () =>
      dispatch({ type: "catalog.install.requested", distro: model().catalogTarget, busy: model().busy }),
    installWsl: () => dispatch({ type: "wsl.install.requested", busy: model().busy }),
    runPrimary: () => {
      const button = model().primaryButton

      dispatch({
        type: "primary.requested",
        distro: model().selectedDistro,
        action: button.action,
        disabled: button.disabled || button.loading,
      })
    },
    close: () => dialog.close(),
  }
}

function DialogWslSetup(props: {
  state: string
  error: string | null
  installable: boolean
  busy: boolean
  onInstall: () => void
}) {
  const language = usePlugin()
  const dialog = useDialog()

  const title = () =>
    props.state === "pendingRestart"
      ? language.t("onboarding.restartRequired")
      : props.installable
        ? language.t("onboarding.wslNotInstalled.title")
        : language.t("onboarding.wslUnavailable.title")

  const description = () => {
    if (props.state === "pendingRestart") return language.t("onboarding.windowsRestartRequired")

    if (!props.installable) return language.t("onboarding.wslUnavailable.description")

    return language.t("onboarding.wslNotInstalled.description")
  }

  return (
    <Dialog fit class="settings-wsl-not-installed-dialog">
      <div class="settings-wsl-not-installed-content">
        <div class="settings-wsl-not-installed-message">
          <svg
            class="settings-wsl-not-installed-icon"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <g clip-path="url(#settings-wsl-warning-clip)">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M12 -0.00244141L23.6926 20.2498H0.308594L12 -0.00244141ZM12.7954 6.32932C12.5844 6.11834 12.2982 5.99982 11.9999 5.99982C11.7015 5.99982 11.4154 6.11834 11.2044 6.32932C10.9934 6.5403 10.8749 6.82645 10.8749 7.12482V11.6248C10.8749 11.9232 10.9934 12.2093 11.2044 12.4203C11.4154 12.6313 11.7015 12.7498 11.9999 12.7498C12.2982 12.7498 12.5844 12.6313 12.7954 12.4203C13.0064 12.2093 13.1249 11.9232 13.1249 11.6248V7.12482C13.1249 6.82645 13.0064 6.5403 12.7954 6.32932ZM13.0605 17.5605C12.7792 17.8418 12.3977 17.9998 11.9999 17.9998C11.6021 17.9998 11.2205 17.8418 10.9392 17.5605C10.6579 17.2792 10.4999 16.8976 10.4999 16.4998C10.4999 16.102 10.6579 15.7205 10.9392 15.4392C11.2205 15.1579 11.6021 14.9998 11.9999 14.9998C12.3977 14.9998 12.7792 15.1579 13.0605 15.4392C13.3418 15.7205 13.4999 16.102 13.4999 16.4998C13.4999 16.8976 13.3418 17.2792 13.0605 17.5605Z"
                fill="#DBDBDB"
              />
            </g>
            <defs>
              <clipPath id="settings-wsl-warning-clip">
                <rect width="24" height="24" fill="white" />
              </clipPath>
            </defs>
          </svg>
          <h2 class="settings-wsl-not-installed-title">{title()}</h2>
          <p class="settings-wsl-not-installed-description">{description()}</p>
          <Show when={!props.installable && props.error}>
            <p class="settings-wsl-unavailable-error">{props.error}</p>
          </Show>
        </div>
        <Show when={props.state === "unavailable" && props.installable}>
          <Button variant="neutral" disabled={props.busy} onClick={props.onInstall}>
            {language.t("onboarding.installWsl")}
          </Button>
        </Show>
        <Show when={props.state !== "unavailable"}>
          <Button variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </Show>
      </div>
    </Dialog>
  )
}

// A call that timed out has no cause; its toast says only that the request failed.
function requestError(language: Context, cause: unknown) {
  console.error("WSL servers request failed", cause instanceof Error ? (cause.stack ?? cause.message) : String(cause))
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: cause === undefined ? undefined : cause instanceof Error ? cause.message : String(cause),
  })
}

function unavailable(error: string): WslServersState {
  return {
    runtime: { available: false, version: null, error },
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    hostJob: "idle",
    distroJobs: {},
  }
}
