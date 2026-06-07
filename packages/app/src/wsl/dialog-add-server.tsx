import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { WslDistroIcon } from "@opencode-ai/ui/wsl-distro-icon"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useWslServers } from "./context"
import type { WslDistroProbe, WslServerConfig } from "./types"

type WslServerStep = "wsl" | "distro" | "opencode"

const STEPS: WslServerStep[] = ["wsl", "distro", "opencode"]

function isHiddenDistro(name: string) {
  return /^docker-desktop(?:-data)?$/i.test(name)
}

interface DialogWslServerProps {
  onAdded?: (distro: string, config: WslServerConfig) => void | Promise<void>
  onCancel?: () => void
  onTitleChange?: (title: string) => void
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
    installDistroView: false,
    installDistroSearch: "",
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
  const filteredInstallableDistros = createMemo(() => {
    const query = normalizeDistroSearch(store.installDistroSearch)
    if (!query) return installableDistros()
    return installableDistros().filter((item) => normalizeDistroSearch(`${item.label} ${item.name}`).includes(query))
  })
  const installingDistro = (name: string) => {
    const job = current()?.job
    return job?.kind === "install-distro" && job.distro === name
  }
  const installingOpencode = createMemo(() => {
    const job = current()?.job
    return job?.kind === "install-opencode" && job.distro === selectedDistro()
  })
  const probingOpencode = createMemo(() => {
    const job = current()?.job
    return job?.kind === "probe-opencode" && job.distro === selectedDistro()
  })
  const opencodeChecking = createMemo(() => !!selectedDistro() && distroReady() && (!opencodeCheck() || probingOpencode()))
  const opencodeStepState = createMemo(() => {
    const check = opencodeCheck()
    if (installingOpencode()) return "working"
    if (opencodeChecking()) return "checking"
    if (opencodeReady() && check?.matchesDesktop !== false) return "ready"
    if (check?.matchesDesktop === false) return "update"
    if (check && !check.resolvedPath) return "missing"
    if (check?.error) return "error"
    return "missing"
  })
  const opencodeStatusText = createMemo(() => {
    const distro = selectedDistro() ?? language.t("wsl.onboarding.selectedDistro")
    if (opencodeStepState() === "working") {
      return opencodeCheck()?.resolvedPath
        ? language.t("wsl.onboarding.updatingOpencodeIn", { distro })
        : language.t("wsl.onboarding.installingOpencodeIn", { distro })
    }
    if (opencodeStepState() === "checking") return language.t("wsl.onboarding.checkingOpencodeIn", { distro })
    if (opencodeStepState() === "error") return language.t("wsl.onboarding.opencodeCheckFailedIn", { distro })
    if (opencodeStepState() === "ready") return language.t("wsl.onboarding.opencodeUpToDateIn", { distro })
    if (opencodeStepState() === "update") return language.t("wsl.onboarding.opencodeUpdateNeededIn", { distro })
    return language.t("wsl.onboarding.opencodeNotInstalledIn", { distro })
  })
  const opencodeDetailRows = createMemo(() => {
    const check = opencodeCheck()
    const middleRows = check?.resolvedPath
      ? [
          {
            label: language.t("wsl.onboarding.opencodeWslVersion"),
            value: check.version ?? language.t("wsl.onboarding.unknown"),
          },
        ]
      : [
          {
            label: language.t("wsl.onboarding.opencodeStatus"),
            value: opencodeChecking()
              ? language.t("wsl.onboarding.checking")
              : opencodeStepState() === "error"
                ? language.t("wsl.onboarding.checkFailed")
                : language.t("wsl.onboarding.notInstalled"),
          },
        ]
    return [
      {
        label: language.t("wsl.onboarding.opencodeDesktopVersion"),
        value: check?.expectedVersion ?? language.t("wsl.onboarding.unknown"),
      },
      ...middleRows,
      {
        label: language.t("wsl.onboarding.opencodeInstallPath"),
        value: check?.resolvedPath ?? language.t("wsl.onboarding.notFoundTitle"),
      },
    ]
  })
  const opencodeHelperText = createMemo(() => {
    if (opencodeStepState() === "ready") return language.t("wsl.onboarding.opencodeReadyToAdd")
    if (opencodeStepState() === "checking" || opencodeStepState() === "working")
      return language.t("wsl.onboarding.opencodeCheckingToContinue")
    if (opencodeStepState() === "missing") return language.t("wsl.onboarding.installOpencodeOnlyToContinue")
    if (opencodeStepState() === "error") return language.t("wsl.onboarding.opencodeCheckAgainToContinue")
    return language.t("wsl.onboarding.installOpencodeToContinue")
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
  const activeStep = createMemo(() => {
    if (!store.step && wslReady()) return "distro"
    if (store.step === "wsl" && wslReady()) return "distro"
    return store.step ?? recommendedStep()
  })
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
            : activeStepIndex() >= index && opencodeReady() && opencodeCheck()?.matchesDesktop !== false
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
      if (activeStep() !== "opencode") return null
      return { key: `probe-opencode:${distro}`, run: () => api.probeOpencode(distro) }
    }
    return null
  })

  let lastAutoProbe: string | null = null
  createEffect(() => {
    props.onTitleChange?.(
      store.installDistroView ? language.t("wsl.onboarding.installDistroTitle") : language.t("wsl.server.add"),
    )
  })

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
    void run(async () => {
      await api.installDistro(name)
      setStore("installDistroView", false)
    })
  }

  const openOpencodeStep = () => {
    const distro = selectedDistro()
    if (!distro) return
    setStore("step", "opencode")
  }
  const back = () => {
    if (store.installDistroView) {
      setStore("installDistroView", false)
      return
    }
    const index = activeStepIndex()
    if (activeStep() === "distro" && wslReady()) {
      cancel()
      return
    }
    if (index <= 0) return
    setStore("step", STEPS[index - 1])
  }

  const primaryLabel = createMemo(() => {
    if (activeStep() === "opencode") return language.t("wsl.server.add")
    return language.t("common.continue")
  })
  const opencodeInstallLabel = createMemo(() =>
    opencodeCheck()?.resolvedPath
      ? language.t("wsl.onboarding.updateOpencode")
      : language.t("wsl.onboarding.installOpencode"),
  )
  const primaryDisabled = createMemo(() => {
    if (store.installDistroView) return true
    if (activeStep() === "wsl") return busy() || !wslReady()
    if (activeStep() === "distro") return busy() || !selectedDistro() || !distroReady()
    if (opencodeNeedsInstall()) return true
    return !allReady() || !selectedDistro() || addDisabled()
  })
  const primaryHelper = createMemo(() => {
    if (store.installDistroView) return null
    if (activeStep() === "wsl" && !wslReady()) return language.t("wsl.onboarding.wslContinueBlocked")
    if (activeStep() === "distro" && !selectedDistro()) return language.t("wsl.onboarding.chooseDistroFirst")
    if (activeStep() === "distro" && !distroReady()) return language.t("wsl.onboarding.fixDistroOrChooseReady")
    if (activeStep() === "opencode" && opencodeChecking())
      return language.t("wsl.onboarding.opencodeCheckingToContinue")
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
    <div class="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
      <Show
        when={!wslServers.isPending}
        fallback={<div class="px-1 py-6 text-12-regular text-text-weak">{language.t("wsl.onboarding.loading")}</div>}
      >
        <Show
          when={!wslServers.isError}
          fallback={<div class="px-1 py-6 text-12-regular text-text-weak">{loadError()}</div>}
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
                  <div class="text-11-medium truncate">
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
            <section>
              <Show
                when={!wslReady()}
                fallback={null}
              >
                <div class="rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger/30 px-5 py-5 flex flex-col gap-5">
                  <div class="flex items-start gap-3">
                    <div class="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-v2-state-fg-danger text-v2-state-fg-danger flex items-center justify-center text-12-medium">
                      !
                    </div>
                    <div class="min-w-0 flex flex-col gap-2">
                      <div class="text-12-medium text-text-strong">
                        {current()?.pendingRestart
                          ? language.t("wsl.onboarding.restartRequiredTitle")
                          : language.t("wsl.onboarding.wslNotReady")}
                      </div>
                      <div class="max-w-[430px] text-12-regular text-text-weak leading-5">
                        {current()?.pendingRestart
                          ? language.t("wsl.onboarding.windowsRestartRequired")
                          : language.t("wsl.onboarding.required")}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center justify-end gap-3">
                    <Show when={!current()?.pendingRestart}>
                      <Button
                        variant="primary"
                        size="small"
                        class="!bg-v2-state-fg-danger !border-v2-state-fg-danger !text-white hover:!bg-v2-state-fg-danger/90"
                        disabled={busy()}
                        onClick={() => void run(() => api.installWsl())}
                      >
                        {language.t("wsl.onboarding.installWsl")}
                      </Button>
                    </Show>
                    <Button
                      variant="ghost"
                      size="small"
                      icon="refresh"
                      disabled={busy()}
                      onClick={() => void run(() => api.probeRuntime())}
                    >
                      {language.t("wsl.onboarding.checkAgain")}
                    </Button>
                  </div>
                </div>
              </Show>
            </section>
          </Show>

          <Show when={activeStep() === "distro"}>
            <Show
              when={store.installDistroView}
              fallback={
                <>
                  <section class="flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-12-medium text-text-weak">{language.t("wsl.onboarding.installedDistros")}</div>
                      <Show when={wslReady()}>
                        <Button
                          variant="ghost"
                          size="small"
                          icon="refresh"
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
                      <div class="overflow-hidden rounded-md border border-border-weak-base">
                        <For each={visibleInstalledDistros()}>
                          {(item) => {
                            const alreadyAdded = () => existingServerDistros().has(item.name)
                            const selected = () => selectedDistro() === item.name
                            const probe = () => current()?.distroProbes[item.name] ?? null
                            const missingTools = () => (probe()?.canExecute ? missingToolNames(probe()!) : [])
                            const ready = () =>
                              !alreadyAdded() &&
                              item.version !== 1 &&
                              !!probe() &&
                              probe()!.canExecute &&
                              missingTools().length === 0
                            const needsAttention = () =>
                              !alreadyAdded() && (item.version === 1 || (!!probe() && !ready()))
                            const expanded = () => selected() && needsAttention()
                            const meta = () => {
                              if (alreadyAdded()) return language.t("wsl.onboarding.alreadyAddedToOpencode")
                              if (selected() && current()?.job?.kind === "probe-distro")
                                return language.t("wsl.onboarding.checkingDistro", { distro: item.name })
                              const parts = [
                                ready() ? language.t("wsl.onboarding.readyStatus") : null,
                                item.version === 2
                                  ? language.t("wsl.onboarding.wsl2")
                                  : item.version === 1
                                    ? language.t("wsl.onboarding.wsl1")
                                    : null,
                                missingTools().length > 0
                                  ? language.t("wsl.onboarding.missingToolsMeta", {
                                      tools: formatToolList(missingTools()),
                                    })
                                  : null,
                                probe() && !probe()!.canExecute ? language.t("wsl.onboarding.needsSetup") : null,
                              ].filter((value): value is string => !!value)
                              return parts.join(" - ") || language.t("wsl.onboarding.installed")
                            }
                            return (
                              <div class="border-b border-border-weak-base last:border-b-0">
                                <div
                                  role={alreadyAdded() ? undefined : "button"}
                                  tabIndex={alreadyAdded() ? undefined : 0}
                                  aria-disabled={alreadyAdded() || busy() ? true : undefined}
                                  class="min-w-0 px-3 py-3 flex items-center justify-between gap-3 transition-colors"
                                  classList={{
                                    "opacity-60": alreadyAdded(),
                                    "cursor-pointer hover:bg-surface-base-hover": !alreadyAdded() && !busy(),
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
                                      class="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-border-strong-base flex items-center justify-center"
                                      classList={{
                                        "border-icon-success-base": selected() && !alreadyAdded(),
                                      }}
                                      aria-hidden="true"
                                    >
                                      <div
                                        class="h-2 w-2 rounded-full bg-icon-success-base"
                                        classList={{ hidden: !selected() || alreadyAdded() }}
                                      />
                                    </div>
                                    <div class="min-w-0 flex flex-col gap-1">
                                      <div class="text-12-medium text-text-strong truncate">{item.name}</div>
                                      <div class="text-11-regular text-text-weak truncate">{meta()}</div>
                                    </div>
                                  </div>
                                  <div class="shrink-0 text-right">
                                    <Show when={alreadyAdded()}>
                                      <span class="text-12-regular text-text-weak">
                                        {language.t("wsl.onboarding.alreadyAdded")}
                                      </span>
                                    </Show>
                                    <Show when={!alreadyAdded() && ready()}>
                                      <span class="text-12-medium text-icon-success-base">
                                        {language.t("wsl.onboarding.readyStatus")}
                                      </span>
                                    </Show>
                                    <Show when={!alreadyAdded() && needsAttention()}>
                                      <div class="flex flex-col items-end gap-1 text-v2-state-fg-warning">
                                        <div class="flex items-center gap-2 text-12-medium">
                                          <span>{language.t("wsl.onboarding.needsAttention")}</span>
                                          <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                                        </div>
                                        <Show when={!expanded()}>
                                          <span class="text-12-medium text-text-strong">
                                            {language.t("wsl.onboarding.viewIssues")}
                                          </span>
                                        </Show>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                                <Show when={expanded()}>
                                  <div class="mx-3 mb-3 rounded-md border border-v2-state-border-warning bg-v2-state-fg-warning/10 px-3 py-3 flex flex-col gap-3">
                                    <div class="flex items-start gap-3">
                                      <Icon name="warning" class="mt-0.5 shrink-0 text-v2-state-fg-warning" />
                                      <div class="min-w-0 flex flex-col gap-1">
                                        <div class="text-12-medium text-text-strong">
                                          <Show
                                            when={missingTools().length > 0}
                                            fallback={distroProblemMessage() ?? language.t("wsl.onboarding.needsSetup")}
                                          >
                                            {language.t("wsl.onboarding.missingRequiredTools")}
                                          </Show>
                                        </div>
                                        <div class="text-11-regular text-text-weak">
                                          <Show when={missingTools().length > 0} fallback={distroProblemMessage()}>
                                            {language.t("wsl.onboarding.toolsRequiredDetail", {
                                              tools: formatToolList(missingTools()),
                                            })}
                                          </Show>
                                        </div>
                                      </div>
                                    </div>
                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                      <div class="flex flex-wrap items-center gap-2">
                                        <For
                                          each={[
                                            { name: "bash", ok: !!probe()?.hasBash },
                                            { name: "curl", ok: !!probe()?.hasCurl },
                                          ]}
                                        >
                                          {(tool) => (
                                            <span class="inline-flex h-7 items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-2.5 text-12-regular text-text-strong">
                                              <span>{tool.name}</span>
                                              <Show
                                                when={tool.ok}
                                                fallback={
                                                  <>
                                                    <span class="h-1.5 w-1.5 rounded-full bg-v2-state-fg-warning" />
                                                    <span class="text-text-weak">
                                                      {language.t("wsl.onboarding.toolMissing")}
                                                    </span>
                                                  </>
                                                }
                                              >
                                                <Icon name="check" size="small" class="text-icon-success-base" />
                                              </Show>
                                            </span>
                                          )}
                                        </For>
                                      </div>
                                      <div class="flex items-center gap-2">
                                        <Button
                                          variant="secondary"
                                          size="small"
                                          icon="terminal"
                                          disabled={busy() || !selectedInstalled()}
                                          onClick={() => runSelectedDistro((distro) => api.openTerminal(distro))}
                                        >
                                          {language.t("wsl.onboarding.openTerminal")}
                                        </Button>
                                        <Button
                                          variant="secondary"
                                          size="small"
                                          icon="refresh"
                                          disabled={busy() || !selectedDistro()}
                                          onClick={() => runSelectedDistro((distro) => api.probeDistro(distro))}
                                        >
                                          {language.t("wsl.onboarding.checkAgain")}
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </Show>

                    <Show when={visibleInstalledDistros().length > 0 && addableInstalledDistros().length === 0}>
                      <div class="text-12-regular text-text-weak">{language.t("wsl.onboarding.allDistrosAdded")}</div>
                    </Show>
                  </section>

                  <Show when={installableDistros().length > 0}>
                    <section class="rounded-md border border-border-weak-base px-3 py-3 flex items-center justify-between gap-3">
                      <div class="min-w-0 flex items-center gap-3">
                        <Icon name="download" size="small" class="shrink-0 text-text-weak" />
                        <div class="min-w-0 flex flex-col gap-1">
                          <div class="text-12-medium text-text-strong">
                            {language.t("wsl.onboarding.needAnotherDistro")}
                          </div>
                          <div class="text-11-regular text-text-weak leading-4">
                            {language.t("wsl.onboarding.installDistroDescription")}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                          setStore("installDistroSearch", "")
                          setStore("installDistroView", true)
                        }}
                      >
                        {language.t("wsl.onboarding.installDistroAction")}
                      </Button>
                    </section>
                  </Show>
                </>
              }
            >
              <section class="flex min-h-0 flex-1 flex-col gap-3">
                <p class="text-12-regular text-text-weak leading-5">{language.t("wsl.onboarding.installDistroIntro")}</p>
                <label class="flex h-7 shrink-0 items-center rounded-md border border-border-weak-base bg-input-base">
                  <span class="sr-only">{language.t("wsl.onboarding.searchDistros")}</span>
                  <span class="flex h-full w-7 shrink-0 items-center justify-center">
                    <Icon name="magnifying-glass" size="small" class="text-text-weak" />
                  </span>
                  <input
                    type="text"
                    value={store.installDistroSearch}
                    onInput={(event) => setStore("installDistroSearch", event.currentTarget.value)}
                    placeholder={language.t("wsl.onboarding.searchDistros")}
                    spellcheck={false}
                    autocomplete="off"
                    autocapitalize="off"
                    class="h-full min-w-0 flex-1 bg-transparent pr-3 text-12-regular text-text-strong outline-none placeholder:text-text-weak"
                  />
                </label>
                <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-weak-base">
                  <div class="flex h-7 shrink-0 items-center border-b border-border-weak-base px-3 text-11-regular text-text-weak">
                    <span>{language.t("wsl.onboarding.availableDistros")}</span>
                  </div>
                  <div class="min-h-0 flex-1 overflow-y-auto">
                    <Show
                      when={filteredInstallableDistros().length > 0}
                      fallback={
                        <div class="flex min-h-40 flex-col items-center justify-center gap-1 px-6 py-8 text-center">
                          <div class="text-12-medium text-text-strong">
                            {language.t("wsl.onboarding.noMatchingDistros")}
                          </div>
                          <div class="text-11-regular text-text-weak">
                            {language.t("wsl.onboarding.noMatchingDistrosHint")}
                          </div>
                        </div>
                      }
                    >
                      <For each={filteredInstallableDistros()}>
                        {(item, index) => (
                          <div class="min-h-[46px] px-3 py-1.5 flex items-center justify-between gap-3 border-b border-border-weak-base last:border-b-0">
                            <div class="min-w-0 flex items-center gap-3">
                              <WslDistroIcon name={item.name} label={item.label} class="h-7 w-7" />
                              <div class="min-w-0 flex flex-col gap-0.5">
                                <div class="flex min-w-0 items-center gap-2">
                                  <span class="text-12-medium text-text-strong truncate">{item.label}</span>
                                  <Show when={index() === 0 && !store.installDistroSearch.trim()}>
                                    <span class="rounded bg-icon-success-base/15 px-2 py-0.5 text-12-medium text-icon-success-base">
                                      {language.t("dialog.provider.tag.recommended")}
                                    </span>
                                  </Show>
                                </div>
                                <div class="text-11-regular text-text-weak truncate">
                                  <Show when={installingDistro(item.name)} fallback={item.name}>
                                    {language.t("wsl.onboarding.installing")}
                                  </Show>
                                </div>
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
                    </Show>
                  </div>
                </div>
              </section>
            </Show>
          </Show>

          <Show when={activeStep() === "opencode"}>
            <section class="flex flex-col gap-3">
              <div class="text-13-medium text-text-strong">{language.t("wsl.onboarding.step.opencode")}</div>
              <div
                class="rounded-md border px-3 py-3 flex items-center gap-3"
                classList={{
                  "border-v2-state-border-success bg-v2-state-bg-success": opencodeStepState() === "ready",
                  "border-v2-state-border-warning bg-v2-state-bg-warning":
                    opencodeStepState() === "update" ||
                    opencodeStepState() === "missing" ||
                    opencodeStepState() === "error",
                  "border-border-weak-base bg-background-base":
                    opencodeStepState() === "checking" || opencodeStepState() === "working",
                }}
              >
                <Show
                  when={opencodeStepState() === "ready"}
                  fallback={
                    <Show
                      when={opencodeStepState() === "checking" || opencodeStepState() === "working"}
                      fallback={
                        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-v2-state-fg-warning text-12-medium text-v2-state-fg-warning">
                          !
                        </span>
                      }
                    >
                      <Spinner class="size-4 shrink-0" />
                    </Show>
                  }
                >
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-v2-state-fg-success">
                    <svg class="h-3 w-3" viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M2.5 6.25L5 8.5L9.5 3.5"
                        fill="none"
                        stroke="#fff"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </span>
                </Show>
                <div class="min-w-0 text-12-medium text-text-strong">{opencodeStatusText()}</div>
              </div>

              <div class="overflow-hidden rounded-md border border-border-weak-base">
                <div class="flex h-10 items-center justify-between gap-3 border-b border-border-weak-base px-3">
                  <span class="text-12-regular text-text-weak">
                    {language.t("wsl.onboarding.opencodeSelectedDistro")}
                  </span>
                  <span class="min-w-0 truncate text-right text-12-medium text-text-strong">
                    {selectedDistro() ?? language.t("wsl.onboarding.selectedDistro")}
                  </span>
                </div>
                <For each={opencodeDetailRows()}>
                  {(row) => (
                    <div class="flex h-10 items-center justify-between gap-3 border-b border-border-weak-base px-3 last:border-b-0">
                      <span class="text-12-regular text-text-weak">{row.label}</span>
                      <span class="min-w-0 truncate text-right text-12-medium text-text-strong">{row.value}</span>
                    </div>
                  )}
                </For>
                <div class="flex min-h-12 items-center justify-between gap-3 border-t border-border-weak-base px-3 py-2">
                  <div>
                    <Show when={opencodeStepState() === "missing" || opencodeStepState() === "update"}>
                      <Button
                        variant="primary"
                        size="normal"
                        class={
                          installingOpencode()
                            ? undefined
                            : "!border-v2-state-fg-success !bg-v2-state-fg-success !text-white hover:!bg-v2-state-fg-success/90"
                        }
                        disabled={busy() || !selectedDistro() || !distroReady()}
                        onClick={() => runSelectedDistro((distro) => api.installOpencode(distro))}
                      >
                        <Show when={installingOpencode()}>
                          <Spinner class="size-4 shrink-0" />
                        </Show>
                        <Show
                          when={!installingOpencode()}
                          fallback={
                            opencodeCheck()?.resolvedPath
                              ? language.t("wsl.onboarding.updatingOpencode")
                              : language.t("wsl.onboarding.installing")
                          }
                        >
                          {opencodeInstallLabel()}
                        </Show>
                      </Button>
                    </Show>
                  </div>
                  <Button
                    variant="secondary"
                    size="normal"
                    icon="refresh"
                    disabled={busy() || !selectedDistro() || !distroReady()}
                    onClick={() => runSelectedDistro((distro) => api.probeOpencode(distro))}
                  >
                    {language.t("wsl.onboarding.checkAgain")}
                  </Button>
                </div>
              </div>
              <div class="text-12-regular text-text-weak">{opencodeHelperText()}</div>
            </section>
          </Show>

          <div class="mt-auto flex items-end justify-between gap-3 pt-5">
            <div>
              <Show when={activeStepIndex() > 0}>
                <Button variant="ghost" size="small" disabled={store.adding} onClick={back}>
                  {language.t("wsl.onboarding.back")}
                </Button>
              </Show>
            </div>
            <div class="flex min-w-0 flex-col items-end gap-1">
              <Show when={!store.installDistroView && activeStep() !== "opencode" && primaryDisabled() && primaryHelper()}>
                {(message) => <div class="max-w-80 text-right text-11-regular text-text-weak">{message()}</div>}
              </Show>
              <div class="flex items-center justify-end gap-2">
                <Button variant="ghost" size="small" disabled={store.adding} onClick={cancel}>
                  {language.t("common.cancel")}
                </Button>
                <Show when={!store.installDistroView}>
                  <Button
                    variant={activeStep() === "opencode" ? "primary" : "secondary"}
                    size="small"
                    class={
                      activeStep() === "opencode" && !primaryDisabled()
                        ? "!border-v2-state-fg-success !bg-v2-state-fg-success !text-white hover:!bg-v2-state-fg-success/90"
                        : undefined
                    }
                    disabled={primaryDisabled()}
                    onClick={runPrimaryAction}
                  >
                    <Show when={store.adding}>
                      <Spinner class="size-4 shrink-0" />
                    </Show>
                    {store.adding ? language.t("wsl.onboarding.adding") : primaryLabel()}
                  </Button>
                </Show>
              </div>
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

function missingToolNames(probe: WslDistroProbe) {
  return [
    probe.hasBash ? null : "bash",
    probe.hasCurl ? null : "curl",
  ].filter((tool): tool is string => !!tool)
}

function formatToolList(tools: string[]) {
  return tools.join(", ")
}

function normalizeDistroSearch(value: string) {
  return value.toLowerCase().replaceAll(/[-_]+/g, " ").trim()
}
