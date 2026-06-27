import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { RadioGroupV2, RadioItemV2 } from "@opencode-ai/ui/v2/radio-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import fuzzysort from "fuzzysort"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useWslServers } from "./context"
import "./dialog-add-wsl-server.css"

type DistroStatusTone = "success" | "warning" | "muted"

function isHiddenDistro(name: string) {
  return /^docker-desktop(?:-data)?$/i.test(name)
}

function isWslRuntimeMissing(error: string | null | undefined) {
  if (!error) return true
  return /WSL is not installed|not been installed|wsl(?:\.exe)? --install/i.test(error)
}

interface DialogWslServerProps {
  onAdded?: (distro: string) => void | Promise<void>
}

export function DialogAddWslServer(props: DialogWslServerProps = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const wslServers = useWslServers()
  const api = platform.wslServers!
  const [store, setStore] = createStore({
    view: "main" as "main" | "catalog",
    selectedDistro: null as string | null,
    catalogSearch: "",
    catalogTarget: null as string | null,
    adding: false,
    probingDistros: false,
  })
  const current = () => wslServers.data
  let disposed = false
  onCleanup(() => {
    disposed = true
  })
  const busy = createMemo(() => !!current()?.job || store.adding)
  const visibleInstalledDistros = createMemo(() =>
    (current()?.installed ?? []).filter((item) => !isHiddenDistro(item.name)),
  )
  const visibleOnlineDistros = createMemo(() => (current()?.online ?? []).filter((item) => !isHiddenDistro(item.name)))
  const defaultInstalledDistro = createMemo(() => visibleInstalledDistros().find((item) => item.isDefault) ?? null)
  const existingServerDistros = createMemo(() => new Set((current()?.servers ?? []).map((item) => item.config.distro)))
  const addableInstalledDistros = createMemo(() =>
    visibleInstalledDistros().filter((item) => !existingServerDistros().has(item.name)),
  )
  const selectedDistro = createMemo(() => {
    if (
      store.selectedDistro &&
      addableInstalledDistros().some((item) => item.name === store.selectedDistro && item.version !== 1)
    ) {
      return store.selectedDistro
    }
    const ready = addableInstalledDistros().find((item) => distroReady(item.name))
    if (ready) return ready.name
    const distro = defaultInstalledDistro()
    if (distro && distro.version !== 1 && !existingServerDistros().has(distro.name)) return distro.name
    return addableInstalledDistros().find((item) => item.version !== 1)?.name ?? null
  })
  const opencodeCheck = createMemo(() => {
    const distro = selectedDistro()
    if (!distro) return null
    return current()?.opencodeChecks[distro] ?? null
  })
  const wslReady = createMemo(() => !!current()?.runtime?.available && !current()?.pendingRestart)
  const runtimeState = createMemo(() => {
    const state = current()
    if (!state) return "loading"
    if (state.pendingRestart) return "pendingRestart"
    if (!state.runtime) return state.job?.kind === "runtime" ? "checking" : "checking"
    if (!state.runtime.available) return "unavailable"
    return "ready"
  })
  function distroReady(name: string) {
    const installed = visibleInstalledDistros().find((item) => item.name === name)
    const probe = current()?.distroProbes[name]
    if (!probe || !installed) return false
    if (installed.version === 1) return false
    return probe.canExecute && probe.hasBash && probe.hasCurl
  }

  function opencodeReady() {
    const check = opencodeCheck()
    return !!check?.resolvedPath && check.matchesDesktop !== false && !check.error
  }

  function checkingStatus(): { text: string; tone: DistroStatusTone } {
    return { text: language.t("wsl.onboarding.distroStatus.checking"), tone: "muted" }
  }

  function distroStatus(name: string): { text: string; tone: DistroStatusTone } | null {
    const installed = visibleInstalledDistros().find((item) => item.name === name)
    if (installed?.version === 1) {
      return { text: language.t("wsl.onboarding.distroStatus.unsupported"), tone: "muted" }
    }
    const job = current()?.job
    const probingDistroJob = job?.kind === "probe-distro" && job.distro === name
    const probingOpencodeJob = job?.kind === "probe-opencode" && job.distro === name
    const probe = current()?.distroProbes[name]
    if (!probe) {
      if (store.probingDistros || probingDistroJob) return checkingStatus()
      return null
    }
    if (!probe.canExecute) {
      if (!installed) return { text: language.t("wsl.onboarding.distroNotInstalled", { distro: name }), tone: "warning" }
      return { text: language.t("wsl.onboarding.openDistroOnce", { distro: name }), tone: "warning" }
    }
    if (!probe.hasBash || !probe.hasCurl) {
      return { text: language.t("wsl.onboarding.distroStatus.missingTools"), tone: "warning" }
    }
    const check = current()?.opencodeChecks[name]
    if (!check) {
      if (store.probingDistros || probingOpencodeJob) return checkingStatus()
      return null
    }
    if (check.matchesDesktop === false) {
      return { text: language.t("wsl.onboarding.updateOpencode"), tone: "warning" }
    }
    if (!check.resolvedPath) {
      return { text: language.t("wsl.onboarding.distroStatus.opencodeMissing"), tone: "warning" }
    }
    return { text: language.t("wsl.onboarding.distroStatus.ready"), tone: "success" }
  }

  function selectedDistroSettled() {
    const distro = selectedDistro()
    if (!distro) return false
    const installed = visibleInstalledDistros().find((item) => item.name === distro)
    if (installed?.version === 1) return false
    if (!current()?.distroProbes[distro]) return false
    if (!distroReady(distro)) return true
    return !!current()?.opencodeChecks[distro]
  }

  const primaryButton = createMemo(() => {
    const distro = selectedDistro()
    const job = current()?.job
    const check = opencodeCheck()
    const ready = !!distro && distroReady(distro)
    const probingSelected = store.probingDistros && !selectedDistroSettled()
    const probingOpencode =
      probingSelected || (ready && (!check || job?.kind === "probe-opencode" || job?.kind === "probe-distro"))
    const installingOpencode = job?.kind === "install-opencode" && job.distro === distro

    if (!ready || probingOpencode) {
      return {
        variant: "contrast" as const,
        label: probingSelected
          ? language.t("wsl.onboarding.distroStatus.checking")
          : language.t("wsl.server.add"),
        disabled: true,
        action: null,
        loading: probingSelected,
        width: null,
      }
    }

    if (!opencodeReady()) {
      const update = !!check?.resolvedPath && check.matchesDesktop === false
      return {
        variant: "neutral" as const,
        label: installingOpencode
          ? language.t("wsl.onboarding.updatingOpencode")
          : update
            ? language.t("wsl.onboarding.updateOpencode")
            : language.t("wsl.onboarding.installOpencode"),
        disabled: busy(),
        action: "install-opencode" as const,
        loading: installingOpencode,
        width: update ? "138px" : "129px",
      }
    }

    return {
      variant: "contrast" as const,
      label: store.adding ? language.t("wsl.onboarding.adding") : language.t("wsl.server.add"),
      disabled: store.adding || (!!job && job.kind !== "probe-opencode" && job.kind !== "probe-distro"),
      action: "add" as const,
      loading: store.adding,
      width: null,
    }
  })

  const installableDistros = createMemo(() => {
    const online = visibleOnlineDistros()
    const installed = new Set(visibleInstalledDistros().map((item) => item.name))
    const hasVersionedUbuntu = online.some((item) => /^Ubuntu-\d/.test(item.name))
    return online
      .filter((item) => !installed.has(item.name))
      .filter((item) => !(item.name === "Ubuntu" && hasVersionedUbuntu))
  })
  const filteredInstallableDistros = createMemo(() => {
    const distros = installableDistros()
    const query = store.catalogSearch.trim()
    if (!query) return distros
    return fuzzysort.go(query, distros, { keys: ["label", "name"] }).map((item) => item.obj)
  })
  const catalogTarget = createMemo(() => {
    const distros = filteredInstallableDistros()
    if (store.catalogTarget && distros.some((item) => item.name === store.catalogTarget)) {
      return store.catalogTarget
    }
    return distros[0]?.name ?? null
  })
  const installingCatalogDistro = createMemo(() => current()?.job?.kind === "install-distro")

  const openCatalog = () => {
    const first = installableDistros()[0]
    setStore({
      view: "catalog",
      catalogSearch: "",
      catalogTarget: first?.name ?? null,
    })
  }

  const autoProbe = createMemo(() => {
    const state = current()
    if (!state || busy()) return null
    if (state.pendingRestart) return null
    if (!state.runtime) return { key: "runtime", run: () => api.probeRuntime() }
    if (!wslReady()) return null
    if (!state.installed.length && !state.online.length) {
      return { key: "distros", run: () => api.refreshDistros() }
    }
    return null
  })

  const needsAddableProbe = createMemo(() => {
    if (!wslReady() || store.view !== "main" || store.probingDistros || store.adding) return false
    const job = current()?.job
    if (job && job.kind !== "probe-distro" && job.kind !== "probe-opencode") return false
    return addableInstalledDistros().some((item) => {
      if (item.version === 1) return false
      if (!current()?.distroProbes[item.name]) return true
      if (distroReady(item.name) && !current()?.opencodeChecks[item.name]) return true
      return false
    })
  })

  const drainAddableProbes = async () => {
    const selected = selectedDistro()
    const items = addableInstalledDistros().filter((item) => item.version !== 1)
    const ordered = selected
      ? [...items.filter((item) => item.name === selected), ...items.filter((item) => item.name !== selected)]
      : items

    for (const item of ordered) {
      if (disposed) return
      if (!current()?.distroProbes[item.name]) await api.probeDistro(item.name)
    }
    for (const item of ordered) {
      if (disposed) return
      if (!distroReady(item.name)) continue
      if (!current()?.opencodeChecks[item.name]) await api.probeOpencode(item.name)
    }
  }

  const probeAllAddable = async () => {
    if (store.probingDistros || store.adding || disposed) return
    setStore("probingDistros", true)
    try {
      await drainAddableProbes()
    } catch (err) {
      if (!disposed) requestError(language, err)
    } finally {
      if (!disposed) setStore("probingDistros", false)
    }
  }

  createEffect(() => {
    if (!needsAddableProbe()) return
    void probeAllAddable()
  })

  let lastAutoProbe: string | null = null
  createEffect(() => {
    const probe = autoProbe()
    if (!probe || probe.key === lastAutoProbe) return
    const key = probe.key
    lastAutoProbe = key
    void (async () => {
      try {
        await probe.run()
      } catch (err) {
        if (disposed) return
        if (lastAutoProbe === key) lastAutoProbe = null
        requestError(language, err)
      }
    })()
  })

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (err) {
      requestError(language, err)
    }
  }

  const refreshDistros = () => {
    void run(async () => {
      await api.refreshDistros()
      await probeAllAddable()
    })
  }

  const installDistro = (name: string) => {
    void run(async () => {
      await api.installDistro(name)
      setStore("view", "main")
      await probeAllAddable()
    })
  }

  const installCatalogDistro = () => {
    if (installingCatalogDistro()) return
    const name = catalogTarget()
    if (!name) return
    installDistro(name)
  }

  const closeCatalog = () => {
    setStore({ view: "main", catalogSearch: "", catalogTarget: null })
    void probeAllAddable()
  }

  const runPrimary = async () => {
    if (primaryButton().loading) return
    const distro = selectedDistro()
    const action = primaryButton().action
    if (!distro || !action) return
    if (action === "install-opencode") {
      await run(() => api.installOpencode(distro))
      return
    }
    setStore("adding", true)
    try {
      await api.addServer(distro)
      if (props.onAdded) {
        await props.onAdded(distro)
      } else {
        dialog.close()
      }
    } catch (err) {
      requestError(language, err)
    } finally {
      setStore("adding", false)
    }
  }

  const loadError = createMemo(() => {
    const error = wslServers.error
    if (!error) return language.t("wsl.onboarding.loadFailed")
    return error instanceof Error ? error.message : String(error)
  })

  return (
    <Show
      when={!wslServers.isPending && !wslServers.isError}
      fallback={
        <Dialog fit class="settings-v2-wsl-dialog">
          <Show
            when={!wslServers.isError}
            fallback={<div class="settings-v2-wsl-loading">{loadError()}</div>}
          >
            <div class="settings-v2-wsl-loading">
              <LoaderV2 />
            </div>
          </Show>
        </Dialog>
      }
    >
      <Show
        when={runtimeState() === "ready"}
        fallback={
          <Show
            when={runtimeState() === "checking" || runtimeState() === "loading"}
            fallback={
              <DialogWslSetup
                state={runtimeState()}
                error={current()?.runtime?.error ?? null}
                installable={isWslRuntimeMissing(current()?.runtime?.error)}
                busy={busy()}
                onInstall={() => void run(() => api.installWsl())}
              />
            }
          >
            <Dialog fit class="settings-v2-wsl-dialog">
              <div class="settings-v2-wsl-loading">
                <LoaderV2 />
              </div>
            </Dialog>
          </Show>
        }
      >
        <Dialog fit class="settings-v2-wsl-dialog">
          <DialogHeader hideClose={true}>
            <DialogTitle>
              {store.view === "main"
                ? language.t("wsl.server.add")
                : language.t("wsl.onboarding.installDistro")}
            </DialogTitle>
          </DialogHeader>
          <DividerV2 />
          <Show
            when={store.view === "main"}
            fallback={
              <>
                <DialogBody class="settings-v2-wsl-dialog-body settings-v2-wsl-catalog-picker">
                  <TextInputV2
                    class="settings-v2-wsl-catalog-search"
                    appearance="large"
                    placeholder={language.t("wsl.onboarding.searchDistros")}
                    value={store.catalogSearch}
                    disabled={busy()}
                    onInput={(event) => setStore("catalogSearch", event.currentTarget.value)}
                  />
                  <div class="settings-v2-wsl-catalog-list">
                    <RadioGroupV2
                      hideLabel
                      class="settings-v2-wsl-distro-group"
                      label={language.t("wsl.onboarding.installDistro")}
                      value={catalogTarget() ?? undefined}
                      onChange={(value) => setStore("catalogTarget", value)}
                      disabled={busy()}
                    >
                      <For each={filteredInstallableDistros()}>
                        {(item) => (
                          <RadioItemV2
                            class="settings-v2-wsl-distro-row settings-v2-wsl-catalog-row"
                            value={item.name}
                            disabled={busy()}
                            label={<span class="settings-v2-wsl-distro-label">{item.label}</span>}
                          />
                        )}
                      </For>
                    </RadioGroupV2>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <ButtonV2 variant="neutral" disabled={busy()} onClick={closeCatalog}>
                    {language.t("common.cancel")}
                  </ButtonV2>
                  <ButtonV2
                    variant={installingCatalogDistro() ? "loading" : "contrast"}
                    disabled={!installingCatalogDistro() && (busy() || !catalogTarget())}
                    style={{ width: "99px" }}
                    onClick={installCatalogDistro}
                  >
                    <Show when={installingCatalogDistro()} fallback={language.t("wsl.onboarding.installDistro")}>
                      <LoaderV2 />
                    </Show>
                  </ButtonV2>
                </DialogFooter>
              </>
            }
          >
            <DialogBody class="settings-v2-wsl-dialog-body">
              <div class="settings-v2-wsl-section-header">
                <span class="settings-v2-wsl-section-title">{language.t("wsl.onboarding.installedDistros")}</span>
                <ButtonV2 variant="ghost-muted" size="small" disabled={busy()} onClick={refreshDistros}>
                  {language.t("wsl.onboarding.checkAgain")}
                </ButtonV2>
              </div>

              <Show
                when={addableInstalledDistros().length > 0}
                fallback={
                  <div class="settings-v2-wsl-distro-list">
                    <div class="settings-v2-wsl-distro-empty">
                      {visibleInstalledDistros().length
                        ? language.t("wsl.onboarding.allDistrosAdded")
                        : language.t("wsl.onboarding.noDistros")}
                    </div>
                  </div>
                }
              >
                <div class="settings-v2-wsl-distro-list">
                  <RadioGroupV2
                    hideLabel
                    class="settings-v2-wsl-distro-group"
                    label={language.t("wsl.onboarding.installedDistros")}
                    value={selectedDistro() ?? undefined}
                    onChange={(value) => setStore("selectedDistro", value)}
                    disabled={busy()}
                  >
                    <For each={addableInstalledDistros()}>
                      {(item) => {
                        const status = () => distroStatus(item.name)
                        return (
                          <RadioItemV2
                            class={`settings-v2-wsl-distro-row${item.version === 1 ? " settings-v2-wsl-distro-row--unsupported" : ""}`}
                            value={item.name}
                            disabled={item.version === 1 || busy()}
                            label={<span class="settings-v2-wsl-distro-label">{item.name}</span>}
                            description={
                              <Show when={status()}>
                                {(value) => (
                                  <span class="settings-v2-wsl-distro-status" data-tone={value().tone}>
                                    {value().text}
                                  </span>
                                )}
                              </Show>
                            }
                          />
                        )
                      }}
                    </For>
                  </RadioGroupV2>
                </div>
              </Show>

              <Show when={installableDistros().length > 0}>
                <button
                  type="button"
                  class="settings-v2-wsl-catalog-card"
                  disabled={busy()}
                  onClick={openCatalog}
                >
                  <span class="settings-v2-wsl-catalog-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.5564 10.4443V13.5554H4.22309C3.24087 13.5554 2.44531 13.5554 2.44531 13.5554V10.4443M11.112 5.99989L8.00087 9.111L4.88976 5.99989M8.00087 9.111L8.00087 2.44434"
                        stroke="currentColor"
                      />
                    </svg>
                  </span>
                  <span class="settings-v2-wsl-catalog-copy">
                    <span class="settings-v2-wsl-catalog-title">{language.t("wsl.onboarding.needAnotherDistro")}</span>
                    <span class="settings-v2-wsl-catalog-description">
                      {language.t("wsl.onboarding.needAnotherDistroHint")}
                    </span>
                  </span>
                  <span class="settings-v2-wsl-catalog-chevron" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6 12L10 8L6 4" stroke="currentColor" />
                    </svg>
                  </span>
                </button>
              </Show>
            </DialogBody>

            <DialogFooter>
              <ButtonV2 variant="neutral" disabled={store.adding} onClick={() => dialog.close()}>
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2
                variant={primaryButton().loading ? "loading" : primaryButton().variant}
                disabled={!primaryButton().loading && primaryButton().disabled}
                style={primaryButton().width ? { width: primaryButton().width! } : undefined}
                onClick={() => void runPrimary()}
              >
                <Show when={primaryButton().loading} fallback={primaryButton().label}>
                  <LoaderV2 />
                </Show>
              </ButtonV2>
            </DialogFooter>
          </Show>
        </Dialog>
      </Show>
    </Show>
  )
}

function DialogWslSetup(props: {
  state: string
  error: string | null
  installable: boolean
  busy: boolean
  onInstall: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const title = () =>
    props.state === "pendingRestart"
      ? language.t("wsl.onboarding.restartRequired")
      : props.installable
        ? language.t("wsl.onboarding.wslNotInstalled.title")
        : language.t("wsl.onboarding.wslUnavailable.title")
  const description = () => {
    if (props.state === "pendingRestart") return language.t("wsl.onboarding.windowsRestartRequired")
    if (!props.installable) return language.t("wsl.onboarding.wslUnavailable.description")
    return language.t("wsl.onboarding.wslNotInstalled.description")
  }

  return (
    <Dialog fit class="settings-v2-wsl-not-installed-dialog">
      <div class="settings-v2-wsl-not-installed-content">
        <div class="settings-v2-wsl-not-installed-message">
          <svg
            class="settings-v2-wsl-not-installed-icon"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <g clip-path="url(#settings-v2-wsl-warning-clip)">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M12 -0.00244141L23.6926 20.2498H0.308594L12 -0.00244141ZM12.7954 6.32932C12.5844 6.11834 12.2982 5.99982 11.9999 5.99982C11.7015 5.99982 11.4154 6.11834 11.2044 6.32932C10.9934 6.5403 10.8749 6.82645 10.8749 7.12482V11.6248C10.8749 11.9232 10.9934 12.2093 11.2044 12.4203C11.4154 12.6313 11.7015 12.7498 11.9999 12.7498C12.2982 12.7498 12.5844 12.6313 12.7954 12.4203C13.0064 12.2093 13.1249 11.9232 13.1249 11.6248V7.12482C13.1249 6.82645 13.0064 6.5403 12.7954 6.32932ZM13.0605 17.5605C12.7792 17.8418 12.3977 17.9998 11.9999 17.9998C11.6021 17.9998 11.2205 17.8418 10.9392 17.5605C10.6579 17.2792 10.4999 16.8976 10.4999 16.4998C10.4999 16.102 10.6579 15.7205 10.9392 15.4392C11.2205 15.1579 11.6021 14.9998 11.9999 14.9998C12.3977 14.9998 12.7792 15.1579 13.0605 15.4392C13.3418 15.7205 13.4999 16.102 13.4999 16.4998C13.4999 16.8976 13.3418 17.2792 13.0605 17.5605Z"
                fill="#DBDBDB"
              />
            </g>
            <defs>
              <clipPath id="settings-v2-wsl-warning-clip">
                <rect width="24" height="24" fill="white" />
              </clipPath>
            </defs>
          </svg>
          <h2 class="settings-v2-wsl-not-installed-title">{title()}</h2>
          <p class="settings-v2-wsl-not-installed-description">{description()}</p>
          <Show when={!props.installable && props.error}>
            <p class="settings-v2-wsl-unavailable-error">{props.error}</p>
          </Show>
        </div>
        <Show when={props.state === "unavailable" && props.installable}>
          <ButtonV2
            variant="neutral"
            disabled={props.busy}
            onClick={props.onInstall}
          >
            {language.t("wsl.onboarding.installWsl")}
          </ButtonV2>
        </Show>
        <Show when={props.state !== "unavailable"}>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </ButtonV2>
        </Show>
      </div>
    </Dialog>
  )
}

function requestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  console.error("WSL servers request failed", err instanceof Error ? (err.stack ?? err.message) : String(err))
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}
