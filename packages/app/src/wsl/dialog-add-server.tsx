import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useWslServers } from "./context"

function isHiddenDistro(name: string) {
  return /^docker-desktop(?:-data)?$/i.test(name)
}

interface DialogWslServerProps {
  onAdded?: (distro: string) => void | Promise<void>
  onCancel?: () => void
}

export function DialogAddWslServer(props: DialogWslServerProps = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const wslServers = useWslServers()
  const api = platform.wslServers!
  const [store, setStore] = createStore({
    selectedDistro: null as string | null,
    adding: false,
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
  const addableInstalledDistros = createMemo(() => {
    return visibleInstalledDistros().filter((item) => !existingServerDistros().has(item.name))
  })
  const selectedDistro = createMemo(() => {
    if (store.selectedDistro && addableInstalledDistros().some((item) => item.name === store.selectedDistro)) {
      return store.selectedDistro
    }
    const distro = defaultInstalledDistro()
    if (distro && !existingServerDistros().has(distro.name)) return distro.name
    return addableInstalledDistros()[0]?.name ?? null
  })
  const selectedProbe = createMemo(() => {
    const distro = selectedDistro()
    if (!distro) return null
    return current()?.distroProbes[distro] ?? null
  })
  const selectedInstalled = createMemo(() => {
    const distro = selectedDistro()
    if (!distro) return null
    return (current()?.installed ?? []).find((item) => item.name === distro) ?? null
  })
  const opencodeCheck = createMemo(() => {
    const distro = selectedDistro()
    if (!distro) return null
    return current()?.opencodeChecks[distro] ?? null
  })
  const wslReady = createMemo(() => !!current()?.runtime?.available && !current()?.pendingRestart)
  const distroReady = createMemo(() => {
    const probe = selectedProbe()
    if (!probe || !selectedDistro()) return false
    if (selectedInstalled()?.version === 1) return false
    return probe.canExecute && probe.hasBash && probe.hasCurl
  })
  const opencodeReady = createMemo(() => {
    const check = opencodeCheck()
    return !!check?.resolvedPath && !check.error
  })
  const distroWarningProbe = createMemo(() => {
    const probe = selectedProbe()
    if (!probe) return null
    if (distroReady()) return null
    return probe
  })
  const distroUnavailableMessage = createMemo(() => {
    const probe = distroWarningProbe()
    const distro = selectedDistro()
    if (!probe || probe.canExecute || !distro) return null
    if (!selectedInstalled()) return language.t("wsl.onboarding.distroNotInstalled", { distro })
    return language.t("wsl.onboarding.openDistroOnce", { distro })
  })
  const distroMissingTools = createMemo(() => {
    const probe = distroWarningProbe()
    if (!probe?.canExecute) return null
    if (probe.hasBash && probe.hasCurl) return null
    return probe
  })
  const installableDistros = createMemo(() => {
    const online = visibleOnlineDistros()
    const installed = new Set(visibleInstalledDistros().map((item) => item.name))
    const hasVersionedUbuntu = online.some((item) => /^Ubuntu-\d/.test(item.name))
    return online
      .filter((item) => !installed.has(item.name))
      .filter((item) => !(item.name === "Ubuntu" && hasVersionedUbuntu))
  })
  const installingDistro = (name: string) => {
    const job = current()?.job
    return job?.kind === "install-distro" && job.distro === name
  }
  const installingOpencode = createMemo(() => {
    const job = current()?.job
    return job?.kind === "install-opencode" && job.distro === selectedDistro()
  })
  const allReady = createMemo(() => wslReady() && distroReady() && opencodeReady())
  const opencodeNeedsInstall = createMemo(() => !opencodeReady() || opencodeCheck()?.matchesDesktop === false)
  const addDisabled = createMemo(() => {
    const job = current()?.job
    if (!job) return store.adding
    return store.adding || job.kind !== "probe-opencode"
  })

  const autoProbe = createMemo(() => {
    const state = current()
    if (!state || busy()) return null
    if (state.pendingRestart) return null
    if (!state.runtime) return { key: "runtime", run: () => api.probeRuntime() }
    if (!wslReady()) return null
    if (!state.installed.length && !state.online.length) {
      return { key: "distros", run: () => api.refreshDistros() }
    }
    const distro = selectedDistro()
    if (distro && !state.distroProbes[distro]) {
      return { key: `probe-distro:${distro}`, run: () => api.probeDistro(distro) }
    }
    if (!distro || !distroReady()) return null
    if (!state.opencodeChecks[distro]) {
      return { key: `probe-opencode:${distro}`, run: () => api.probeOpencode(distro) }
    }
    return null
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
        // Allow the same probe to run again when reactive inputs next change
        // (e.g. user reselects a distro). Without this the user would be stuck
        // on a transient wsl.exe failure until they pick a different distro.
        if (lastAutoProbe === key) lastAutoProbe = null
        requestError(language, err)
      }
    })()
  })

  const wslMessage = createMemo(() => {
    const state = current()
    if (!state || state.job?.kind === "runtime") return language.t("wsl.onboarding.checkingRuntime")
    if (state.pendingRestart) return language.t("wsl.onboarding.restartRequired")
    if (state.runtime?.available) return state.runtime.version ?? language.t("wsl.onboarding.ready")
    return state.runtime?.error ?? language.t("wsl.onboarding.required")
  })

  const distroMessage = createMemo(() => {
    const state = current()
    if (!state) return language.t("wsl.onboarding.checkingDistros")
    const distro = selectedDistro()
    if (state.job?.kind === "install-distro")
      return language.t("wsl.onboarding.installingDistro", { distro: state.job.distro })
    if (state.job?.kind === "probe-distro")
      return language.t("wsl.onboarding.checkingDistro", { distro: state.job.distro })
    if (state.job?.kind === "distros") return language.t("wsl.onboarding.listingDistros")
    if (distroUnavailableMessage()) return distroUnavailableMessage()!
    if (selectedProbe() && distroReady())
      return language.t("wsl.onboarding.distroReady", { distro: selectedProbe()!.name })
    if (distro) return language.t("wsl.onboarding.finishingDistro", { distro })
    return language.t("wsl.onboarding.pickDistro")
  })

  const opencodeMessage = createMemo(() => {
    const state = current()
    if (!state) return language.t("wsl.onboarding.checkingOpencode")
    const distro = selectedDistro()
    if (state.job?.kind === "install-opencode") {
      return distro
        ? language.t("wsl.onboarding.updatingOpencodeIn", { distro })
        : language.t("wsl.onboarding.updatingOpencode")
    }
    if (state.job?.kind === "probe-opencode") {
      return distro
        ? language.t("wsl.onboarding.checkingOpencodeIn", { distro })
        : language.t("wsl.onboarding.checkingOpencode")
    }
    if (opencodeCheck()?.error) return opencodeCheck()!.error
    if (opencodeCheck()?.matchesDesktop === false) {
      return distro
        ? language.t("wsl.onboarding.updateOpencodeIn", { distro })
        : language.t("wsl.onboarding.updateOpencode")
    }
    if (opencodeReady()) {
      return distro
        ? language.t("wsl.onboarding.opencodeReadyIn", { distro })
        : language.t("wsl.onboarding.opencodeReady")
    }
    return distro
      ? language.t("wsl.onboarding.installOpencodeIn", { distro })
      : language.t("wsl.onboarding.chooseDistroFirst")
  })

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (err) {
      requestError(language, err)
    }
  }

  const runSelectedDistro = (action: (distro: string) => Promise<unknown>) => {
    const distro = selectedDistro()
    if (!distro) return
    void run(() => action(distro))
  }

  const selectDistro = (name: string) => {
    setStore("selectedDistro", name)
  }

  const installDistro = (name: string) => {
    setStore("selectedDistro", name)
    void run(() => api.installDistro(name))
  }

  const cancel = () => {
    if (props.onCancel) {
      props.onCancel()
      return
    }
    dialog.close()
  }

  const finish = async () => {
    const distro = selectedDistro()
    if (!distro) return
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
    <div class="px-5 pb-5 flex flex-col gap-5">
      <Show
        when={!wslServers.isPending}
        fallback={<div class="px-1 py-6 text-14-regular text-text-weak">{language.t("wsl.onboarding.loading")}</div>}
      >
        <Show
          when={!wslServers.isError}
          fallback={<div class="px-1 py-6 text-14-regular text-text-weak">{loadError()}</div>}
        >
          <section class="flex flex-col gap-2">
            <div class="text-12-medium text-text-weak">{language.t("wsl.server.label")}</div>
            <div class="rounded-md border border-border-weak-base px-3 py-3 flex items-center justify-between gap-3">
              <div class="min-w-0 flex flex-col gap-1">
                <div class="text-13-medium text-text-strong">{wslReady() ? language.t("wsl.onboarding.ready") : wslMessage()}</div>
                <Show when={current()?.pendingRestart}>
                  <div class="text-12-regular text-text-warning-base">
                    {language.t("wsl.onboarding.windowsRestartRequired")}
                  </div>
                </Show>
              </div>
              <Show when={current()?.runtime && !wslReady() && !current()?.pendingRestart}>
                <Button variant="secondary" size="small" disabled={busy()} onClick={() => void run(() => api.installWsl())}>
                  {language.t("wsl.onboarding.installWsl")}
                </Button>
              </Show>
            </div>
          </section>

          <section class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-3">
              <div class="text-12-medium text-text-weak">{language.t("wsl.onboarding.installedDistros")}</div>
              <Show when={wslReady()}>
                <Button variant="ghost" size="small" disabled={busy()} onClick={() => void run(() => api.refreshDistros())}>
                  {language.t("wsl.onboarding.refresh")}
                </Button>
              </Show>
            </div>
            <Show
              when={visibleInstalledDistros().length > 0}
              fallback={
                <div class="rounded-md border border-border-weak-base px-3 py-3 text-12-regular text-text-weak">
                  {current()?.runtime?.available
                    ? language.t("wsl.onboarding.noDistros")
                    : language.t("wsl.onboarding.checkingDistros")}
                </div>
              }
            >
              <div class="rounded-md border border-border-weak-base overflow-hidden">
                <For each={visibleInstalledDistros()}>
                  {(item) => {
                    const alreadyAdded = () => existingServerDistros().has(item.name)
                    const selected = () => selectedDistro() === item.name
                    return (
                      <button
                        type="button"
                        class="w-full min-w-0 px-3 py-2.5 flex items-center justify-between gap-3 text-left border-b border-l-2 border-l-transparent border-border-weak-base last:border-b-0 transition-colors"
                        classList={{
                          "border-l-border-strong-base": selected(),
                          "hover:border-l-border-strong-base": !alreadyAdded(),
                          "opacity-60": alreadyAdded(),
                        }}
                        disabled={busy() || alreadyAdded()}
                        onClick={() => selectDistro(item.name)}
                      >
                        <div class="min-w-0 flex flex-col gap-0.5">
                          <div class="text-13-medium text-text-strong truncate">{item.name}</div>
                          <Show when={selected() && !alreadyAdded()}>
                            <div class="text-12-regular text-text-weak">{distroMessage()}</div>
                          </Show>
                        </div>
                        <div class="shrink-0 flex items-center gap-2">
                          <Show when={item.isDefault}>
                            <span class="text-12-regular text-text-weak">{language.t("common.default")}</span>
                          </Show>
                          <Show when={alreadyAdded()}>
                            <span class="text-12-regular text-text-weak">{language.t("wsl.onboarding.alreadyAdded")}</span>
                          </Show>
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>

            <Show when={visibleInstalledDistros().length > 0 && addableInstalledDistros().length === 0}>
              <div class="text-12-regular text-text-weak">{language.t("wsl.onboarding.allDistrosAdded")}</div>
            </Show>

            <Show when={selectedInstalled()?.version === 1 || distroUnavailableMessage() || distroMissingTools()}>
              <div class="rounded-md border border-border-weak-base px-3 py-3 flex flex-col gap-2">
                <Show when={selectedInstalled()?.version === 1}>
                  <div class="text-12-regular text-text-warning-base">{language.t("wsl.onboarding.wsl2Required")}</div>
                </Show>
                <Show when={distroUnavailableMessage()}>
                  {(message) => <div class="text-12-regular text-text-warning-base">{message()}</div>}
                </Show>
                <Show when={distroMissingTools()}>
                  <div class="text-12-regular text-text-warning-base">{language.t("wsl.onboarding.toolsRequired")}</div>
                </Show>
                <div class="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busy() || !selectedInstalled()}
                    onClick={() => runSelectedDistro((distro) => api.openTerminal(distro))}
                  >
                    {language.t("wsl.onboarding.openTerminal")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy() || !selectedDistro()}
                    onClick={() => runSelectedDistro((distro) => api.probeDistro(distro))}
                  >
                    {language.t("wsl.onboarding.refresh")}
                  </Button>
                </div>
              </div>
            </Show>
          </section>

          <Show when={installableDistros().length > 0}>
            <section class="flex flex-col gap-2">
              <div class="text-12-medium text-text-weak">{language.t("wsl.onboarding.availableDistros")}</div>
              <div class="rounded-md border border-border-weak-base overflow-hidden">
                <For each={installableDistros()}>
                  {(item) => (
                    <div class="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-border-weak-base last:border-b-0">
                      <div class="min-w-0 text-13-medium text-text-strong truncate">{item.label}</div>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={busy()}
                        onClick={() => installDistro(item.name)}
                      >
                        <Show when={installingDistro(item.name)}>
                          <Spinner class="size-4 shrink-0" />
                        </Show>
                        {installingDistro(item.name)
                          ? language.t("wsl.onboarding.installing")
                          : language.t("wsl.onboarding.install")}
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>

          <section class="flex flex-col gap-2">
            <div class="text-12-medium text-text-weak">{language.t("wsl.onboarding.step.opencode")}</div>
            <div class="rounded-md border border-border-weak-base px-3 py-3 flex flex-col gap-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 text-12-regular text-text-weak whitespace-pre-wrap break-words">{opencodeMessage()}</div>
                <div class="shrink-0 flex items-center gap-2">
                  <Show when={selectedDistro() && distroReady()}>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={busy()}
                      onClick={() => runSelectedDistro((distro) => api.probeOpencode(distro))}
                    >
                      {language.t("wsl.onboarding.refresh")}
                    </Button>
                  </Show>
                  <Show when={selectedDistro() && distroReady() && opencodeNeedsInstall()}>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={busy()}
                      onClick={() => runSelectedDistro((distro) => api.installOpencode(distro))}
                    >
                      <Show when={installingOpencode()}>
                        <Spinner class="size-4 shrink-0" />
                      </Show>
                      {opencodeCheck()?.resolvedPath
                        ? language.t("wsl.onboarding.updateOpencode")
                        : language.t("wsl.onboarding.installOpencode")}
                    </Button>
                  </Show>
                </div>
              </div>

              <Show when={opencodeCheck()?.matchesDesktop === false ? opencodeCheck() : null}>
                {(check) => (
                  <div class="rounded-md border border-border-weak-base px-3 py-3 flex flex-col gap-1">
                    <div class="text-12-regular text-text-weak">
                      {language.t("wsl.onboarding.path", {
                        path: check().resolvedPath ?? language.t("wsl.onboarding.notFound"),
                      })}
                    </div>
                    <div class="text-12-regular text-text-weak">
                      {language.t("wsl.onboarding.version", {
                        version: check().version ?? language.t("wsl.onboarding.unknown"),
                      })}
                      <Show when={check().expectedVersion}>
                        {(expected) => (
                          <span>{` · ${language.t("wsl.onboarding.desktopVersion", { version: expected() })}`}</span>
                        )}
                      </Show>
                    </div>
                    <div class="text-12-regular text-text-warning-base">
                      {language.t("wsl.onboarding.versionMismatch")}
                    </div>
                  </div>
                )}
              </Show>
            </div>
          </section>

          <div class="flex items-center justify-end gap-2">
            <Button variant="ghost" size="large" disabled={store.adding} onClick={cancel}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              disabled={!allReady() || !selectedDistro() || addDisabled()}
              onClick={() => void finish()}
            >
              {store.adding ? language.t("wsl.onboarding.adding") : language.t("wsl.server.add")}
            </Button>
          </div>
        </Show>
      </Show>
    </div>
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
