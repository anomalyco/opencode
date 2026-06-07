import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useWslServers } from "./context"
import { enterWslOpencodeStep } from "./settings-model"
import type { WslServerConfig } from "./types"

type WslServerStep = "wsl" | "distro" | "opencode"

const STEPS: WslServerStep[] = ["wsl", "distro", "opencode"]

function isHiddenDistro(name: string) {
  return /^docker-desktop(?:-data)?$/i.test(name)
}

interface DialogWslServerProps {
  onAdded?: (distro: string, config: WslServerConfig) => void | Promise<void>
  onCancel?: () => void
}

export function DialogAddWslServer(props: DialogWslServerProps = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const wslServers = useWslServers()
  const api = platform.wslServers!
  const [store, setStore] = createStore({
    step: undefined as WslServerStep | undefined,
    selectedDistro: null as string | null,
    adding: false,
    installableOpen: false,
    opencodeDetailsOpen: false,
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
  const distroProblemMessage = createMemo(() => {
    const distro = selectedDistro()
    if (selectedInstalled()?.version === 1) return language.t("wsl.onboarding.wsl1Unsupported")
    if (distroUnavailableMessage()) return language.t("wsl.onboarding.firstRunRequired", { distro })
    const probe = distroMissingTools()
    if (!probe) return null
    if (!probe.hasBash && !probe.hasCurl) return language.t("wsl.onboarding.toolsRequired")
    if (!probe.hasBash) return language.t("wsl.onboarding.bashRequired")
    return language.t("wsl.onboarding.curlRequired")
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
  const recommendedStep = createMemo<WslServerStep>(() => {
    if (!wslReady()) return "wsl"
    if (!distroReady()) return "distro"
    return "opencode"
  })
  const activeStep = createMemo(() => store.step ?? recommendedStep())
  const activeStepIndex = createMemo(() => STEPS.indexOf(activeStep()))
  const steps = createMemo(() => {
    const recommendedIndex = STEPS.indexOf(recommendedStep())
    return STEPS.map((step) => {
      const index = STEPS.indexOf(step)
      const done =
        step === "wsl"
          ? wslReady()
          : step === "distro"
            ? distroReady()
            : opencodeReady() && opencodeCheck()?.matchesDesktop !== false
      return {
        step,
        title:
          step === "wsl"
            ? language.t("wsl.server.label")
            : step === "distro"
              ? language.t("wsl.onboarding.step.distro")
              : language.t("wsl.onboarding.step.opencode"),
        done,
        active: activeStep() === step,
        locked: index > recommendedIndex && !done,
      }
    })
  })
  const installableOpen = createMemo(
    () => store.installableOpen || addableInstalledDistros().length === 0 || !!distroProblemMessage(),
  )

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
    setStore("step", "distro")
    void run(() => api.installDistro(name))
  }

  const openOpencodeStep = () => {
    const distro = selectedDistro()
    if (!distro) return
    void run(() => enterWslOpencodeStep(distro, api.probeOpencode, (step) => setStore("step", step)))
  }
  const back = () => {
    const index = activeStepIndex()
    if (index <= 0) return
    setStore("step", STEPS[index - 1])
  }

  const primaryLabel = createMemo(() => {
    if (activeStep() === "opencode" && opencodeNeedsInstall()) {
      return opencodeCheck()?.resolvedPath
        ? language.t("wsl.onboarding.updateOpencode")
        : language.t("wsl.onboarding.installOpencode")
    }
    if (activeStep() === "opencode") return language.t("wsl.server.add")
    return language.t("common.continue")
  })
  const primaryDisabled = createMemo(() => {
    if (activeStep() === "wsl") return busy() || !wslReady()
    if (activeStep() === "distro") return busy() || !selectedDistro() || !distroReady()
    if (opencodeNeedsInstall()) return busy() || !selectedDistro() || !distroReady()
    return !allReady() || !selectedDistro() || addDisabled()
  })
  const primaryHelper = createMemo(() => {
    if (activeStep() === "wsl" && !wslReady()) return language.t("wsl.onboarding.wslContinueBlocked")
    if (activeStep() === "distro" && !selectedDistro()) return language.t("wsl.onboarding.chooseDistroFirst")
    if (activeStep() === "distro" && !distroReady())
      return distroProblemMessage() ?? language.t("wsl.onboarding.distroContinueBlocked")
    if (activeStep() === "opencode" && opencodeNeedsInstall())
      return language.t("wsl.onboarding.installOpencodeToContinue")
    if (activeStep() === "opencode" && !allReady()) return language.t("wsl.onboarding.opencodeContinueBlocked")
    return null
  })
  const runPrimaryAction = () => {
    if (primaryDisabled()) return
    if (activeStep() === "wsl") {
      setStore("step", "distro")
      return
    }
    if (activeStep() === "distro") {
      openOpencodeStep()
      return
    }
    if (opencodeNeedsInstall()) {
      runSelectedDistro((distro) => api.installOpencode(distro))
      return
    }
    void finish()
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
      const config = await api.addServer(distro)
      if (props.onAdded) {
        await props.onAdded(distro, config)
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
    <div class="flex min-h-[500px] flex-col gap-4 px-5 pb-5">
      <Show
        when={!wslServers.isPending}
        fallback={<div class="px-1 py-6 text-14-regular text-text-weak">{language.t("wsl.onboarding.loading")}</div>}
      >
        <Show
          when={!wslServers.isError}
          fallback={<div class="px-1 py-6 text-14-regular text-text-weak">{loadError()}</div>}
        >
          <div class="flex items-center gap-2 pb-2">
            <For each={steps()}>
              {(item, index) => (
                <button
                  type="button"
                  class="basis-0 flex-1 min-w-0 border-b pb-2 text-left transition-colors disabled:cursor-default"
                  classList={{
                    "border-border-strong-base text-text-strong": item.active,
                    "border-icon-success-base text-text-strong": !item.active && item.done,
                    "border-border-weak-base text-text-weak": !item.active && !item.done,
                    "opacity-45": item.locked,
                  }}
                  disabled={item.locked}
                  onClick={() => setStore("step", item.step)}
                >
                  <div class="text-12-medium truncate">
                    <Show
                      when={item.done && !item.active}
                      fallback={
                        <>
                          {index() + 1}. {item.title}
                        </>
                      }
                    >
                      ✓ {item.title}
                    </Show>
                  </div>
                </button>
              )}
            </For>
          </div>

          <Show when={activeStep() === "wsl"}>
            <section class="flex flex-col gap-2">
              <div class="text-12-medium text-text-weak">{language.t("wsl.server.label")}</div>
              <div class="rounded-md border border-border-weak-base px-3 py-3 flex items-center justify-between gap-3">
                <div class="min-w-0 flex flex-col gap-1">
                  <div class="text-13-medium text-text-strong">
                    {current()?.pendingRestart
                      ? language.t("wsl.onboarding.restartRequiredTitle")
                      : wslReady()
                        ? language.t("wsl.onboarding.ready")
                        : language.t("wsl.onboarding.wslNotReady")}
                  </div>
                  <div class="text-12-regular text-text-weak">
                    {wslReady() ? language.t("wsl.onboarding.readyDescription") : wslMessage()}
                  </div>
                  <Show when={current()?.pendingRestart}>
                    <div class="text-12-regular text-text-warning-base">
                      {language.t("wsl.onboarding.windowsRestartRequired")}
                    </div>
                  </Show>
                </div>
                <Show
                  when={current()?.runtime && !wslReady() && !current()?.pendingRestart}
                  fallback={
                    <Show when={!wslReady()}>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={busy()}
                        onClick={() => void run(() => api.probeRuntime())}
                      >
                        {language.t("wsl.onboarding.checkAgain")}
                      </Button>
                    </Show>
                  }
                >
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busy()}
                    onClick={() => void run(() => api.installWsl())}
                  >
                    {language.t("wsl.onboarding.installWsl")}
                  </Button>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={activeStep() === "distro"}>
            <section class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-3">
                <div class="text-12-medium text-text-weak">{language.t("wsl.onboarding.installedDistros")}</div>
                <Show when={wslReady()}>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy()}
                    onClick={() => void run(() => api.refreshDistros())}
                  >
                    {language.t("wsl.onboarding.checkAgain")}
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
                <div class="max-h-44 overflow-y-auto rounded-md border border-border-weak-base">
                  <For each={visibleInstalledDistros()}>
                    {(item) => {
                      const alreadyAdded = () => existingServerDistros().has(item.name)
                      const selected = () => selectedDistro() === item.name
                      return (
                        <div
                          role={alreadyAdded() ? undefined : "button"}
                          tabIndex={alreadyAdded() ? undefined : 0}
                          aria-disabled={alreadyAdded() || busy() ? true : undefined}
                          class="min-w-0 px-3 py-2.5 flex items-center justify-between gap-3 border-b border-l-2 border-l-transparent border-border-weak-base last:border-b-0 transition-colors"
                          classList={{
                            "border-l-border-strong-base": selected(),
                            "opacity-55": alreadyAdded(),
                            "cursor-pointer": !alreadyAdded() && !busy(),
                          }}
                          onClick={() => {
                            if (alreadyAdded() || busy()) return
                            selectDistro(item.name)
                          }}
                          onKeyDown={(event) => {
                            if (alreadyAdded() || busy()) return
                            if (event.key !== "Enter" && event.key !== " ") return
                            event.preventDefault()
                            selectDistro(item.name)
                          }}
                        >
                          <div class="min-w-0 flex items-start gap-3">
                            <div
                              class="mt-0.5 h-4 w-4 rounded-full border border-border-strong-base flex items-center justify-center shrink-0"
                              classList={{ "border-text-strong": selected() }}
                              aria-hidden="true"
                            >
                              <div class="h-2 w-2 rounded-full bg-text-strong" classList={{ hidden: !selected() }} />
                            </div>
                            <div class="min-w-0 flex flex-col gap-0.5">
                              <div class="text-13-medium text-text-strong truncate">{item.name}</div>
                              <div class="text-12-regular text-text-weak truncate">
                                <Show
                                  when={alreadyAdded()}
                                  fallback={
                                    selected()
                                      ? distroMessage()
                                      : item.isDefault
                                        ? language.t("wsl.onboarding.defaultWslDistro")
                                        : item.version === 2
                                          ? language.t("wsl.onboarding.wsl2")
                                          : language.t("wsl.onboarding.installed")
                                  }
                                >
                                  {language.t("wsl.onboarding.alreadyAddedToOpencode")}
                                </Show>
                              </div>
                            </div>
                          </div>
                          <div class="shrink-0 flex items-center gap-2">
                            <Show when={alreadyAdded()}>
                              <span class="text-12-regular text-text-weak">
                                {language.t("wsl.onboarding.alreadyAdded")}
                              </span>
                            </Show>
                            <Show when={!alreadyAdded() && selected() && distroReady()}>
                              <span class="text-12-medium text-text-strong">{language.t("wsl.onboarding.ready")}</span>
                            </Show>
                            <Show when={!alreadyAdded() && !selected()}>
                              <span class="text-12-medium text-text-weak">{language.t("wsl.onboarding.select")}</span>
                            </Show>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>

              <Show when={visibleInstalledDistros().length > 0 && addableInstalledDistros().length === 0}>
                <div class="text-12-regular text-text-weak">{language.t("wsl.onboarding.allDistrosAdded")}</div>
              </Show>

              <Show when={distroProblemMessage()}>
                {(message) => (
                  <div class="rounded-md border border-border-weak-base px-3 py-3 flex flex-col gap-2">
                    <div class="text-12-regular text-text-warning-base">{message()}</div>
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
                        {language.t("wsl.onboarding.checkAgain")}
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
            </section>

            <Show when={installableDistros().length > 0}>
              <section class="flex flex-col gap-2">
                <button
                  type="button"
                  class="flex items-center justify-between gap-3 text-left text-12-medium text-text-weak"
                  onClick={() => setStore("installableOpen", !store.installableOpen)}
                >
                  <span>{language.t("wsl.onboarding.installNewDistro")}</span>
                  <span>
                    {installableOpen() ? language.t("wsl.onboarding.collapse") : language.t("wsl.onboarding.expand")}
                  </span>
                </button>
                <Show when={installableOpen()}>
                  <div class="max-h-36 overflow-y-auto rounded-md border border-border-weak-base">
                    <For each={installableDistros()}>
                      {(item) => (
                        <div class="px-3 py-2.5 flex items-center justify-between gap-3 border-b border-border-weak-base last:border-b-0">
                          <div class="min-w-0 flex flex-col gap-0.5">
                            <div class="text-13-medium text-text-strong truncate">{item.label}</div>
                            <div class="text-12-regular text-text-weak truncate">
                              <Show when={installingDistro(item.name)} fallback={item.name}>
                                {language.t("wsl.onboarding.installing")}
                              </Show>
                            </div>
                          </div>
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
                </Show>
              </section>
            </Show>
          </Show>

          <Show when={activeStep() === "opencode"}>
            <section class="flex flex-col gap-2">
              <div class="text-12-medium text-text-weak">{language.t("wsl.onboarding.step.opencode")}</div>
              <div class="rounded-md border border-border-weak-base px-3 py-3 flex flex-col gap-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex flex-col gap-1">
                    <div class="text-13-medium text-text-strong">
                      <Show
                        when={opencodeReady()}
                        fallback={
                          opencodeCheck()?.matchesDesktop === false
                            ? language.t("wsl.onboarding.opencodeUpdateRequired")
                            : language.t("wsl.onboarding.opencodeMissing", {
                                distro: selectedDistro() ?? language.t("wsl.onboarding.selectedDistro"),
                              })
                        }
                      >
                        {language.t("wsl.onboarding.opencodeReadyIn", {
                          distro: selectedDistro() ?? language.t("wsl.onboarding.selectedDistro"),
                        })}
                      </Show>
                    </div>
                    <div class="text-12-regular text-text-weak whitespace-pre-wrap break-words">
                      {opencodeMessage()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={busy() || !selectedDistro() || !distroReady()}
                    onClick={() => runSelectedDistro((distro) => api.probeOpencode(distro))}
                  >
                    {language.t("wsl.onboarding.checkAgain")}
                  </Button>
                </div>

                <Show when={opencodeCheck()?.matchesDesktop === false ? opencodeCheck() : null}>
                  {(check) => (
                    <div class="rounded-md border border-border-weak-base px-3 py-3 flex flex-col gap-2">
                      <div class="text-12-regular text-text-weak">
                        {language.t("wsl.onboarding.desktopVersion", {
                          version: check().expectedVersion ?? language.t("wsl.onboarding.unknown"),
                        })}
                      </div>
                      <div class="text-12-regular text-text-weak">
                        {language.t("wsl.onboarding.wslVersion", {
                          version: check().version ?? language.t("wsl.onboarding.unknown"),
                        })}
                      </div>
                      <button
                        type="button"
                        class="self-start text-12-medium text-text-weak"
                        onClick={() => setStore("opencodeDetailsOpen", !store.opencodeDetailsOpen)}
                      >
                        {store.opencodeDetailsOpen
                          ? language.t("wsl.onboarding.hideDetails")
                          : language.t("wsl.onboarding.showDetails")}
                      </button>
                      <Show when={store.opencodeDetailsOpen}>
                        <div class="text-12-regular text-text-weak">
                          {language.t("wsl.onboarding.path", {
                            path: check().resolvedPath ?? language.t("wsl.onboarding.notFound"),
                          })}
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            </section>
          </Show>

          <div class="mt-auto flex items-end justify-between gap-3 pt-5">
            <div>
              <Show when={activeStepIndex() > 0}>
                <Button variant="ghost" size="small" disabled={busy() || store.adding} onClick={back}>
                  {language.t("wsl.onboarding.back")}
                </Button>
              </Show>
            </div>
            <div class="flex min-w-0 flex-col items-end gap-1">
              <div class="flex items-center justify-end gap-2">
                <Button variant="ghost" size="small" disabled={store.adding} onClick={cancel}>
                  {language.t("common.cancel")}
                </Button>
                <Button
                  variant={activeStep() === "opencode" && !opencodeNeedsInstall() ? "primary" : "secondary"}
                  size="small"
                  disabled={primaryDisabled()}
                  onClick={runPrimaryAction}
                >
                  <Show when={store.adding || installingOpencode()}>
                    <Spinner class="size-4 shrink-0" />
                  </Show>
                  {store.adding ? language.t("wsl.onboarding.adding") : primaryLabel()}
                </Button>
              </div>
              <Show when={primaryDisabled() && primaryHelper()}>
                {(message) => <div class="max-w-80 text-right text-12-regular text-text-weak">{message()}</div>}
              </Show>
            </div>
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
