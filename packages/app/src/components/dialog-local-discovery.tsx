import type { LocalInstance } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Match, Show, Switch, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"

type ScanState = "idle" | "scanning" | "done" | "error"

export function DialogLocalDiscovery() {
  const dialog = useDialog()
  const sdk = useSDK()

  const [scanState, setScanState] = createSignal<ScanState>("idle")
  const [instances, setInstances] = createSignal<LocalInstance[]>([])
  const [errorMsg, setErrorMsg] = createSignal<string>()
  // Track configured/removed state locally so UI reflects changes without re-scan.
  // Key: instance id, value: providerID string (added) or null (removed)
  const [localConfig, setLocalConfig] = createSignal(new Map<string, string | null>())
  const [pending, setPending] = createSignal(new Set<string>())

  function goBack() {
    void import("./dialog-select-provider").then((m) => {
      dialog.show(() => <m.DialogSelectProvider />)
    })
  }

  function effectiveProviderID(instance: LocalInstance): string | undefined {
    const local = localConfig()
    if (local.has(instance.id)) {
      const v = local.get(instance.id)
      return v ?? undefined
    }
    return instance.configuredProviderID
  }

  function isConfigured(instance: LocalInstance) {
    return effectiveProviderID(instance) !== undefined
  }

  function setInstancePending(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function scan() {
    setScanState("scanning")
    setInstances([])
    setErrorMsg(undefined)
    sdk.client.local
      .scan({ directory: sdk.directory })
      .then((res) => {
        setInstances(res.data ?? [])
        setScanState("done")
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
        setScanState("error")
      })
  }

  function addProvider(instance: LocalInstance) {
    setInstancePending(instance.id, true)
    sdk.client.local
      .connect({
        directory: sdk.directory,
        localConnectPayload: { id: instance.id, name: instance.name, baseURL: instance.baseURL },
      })
      .then((res) => {
        setLocalConfig((prev) => new Map(prev).set(instance.id, res.data ?? instance.id))
        showToast({
          variant: "success",
          icon: "circle-check",
          title: `Added ${instance.name}`,
          description: "Restart OpenCode to use local providers.",
        })
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        showToast({ title: `Failed to add ${instance.name}`, description: msg })
      })
      .finally(() => setInstancePending(instance.id, false))
  }

  function removeProvider(instance: LocalInstance) {
    const providerID = effectiveProviderID(instance)
    if (!providerID) return
    setInstancePending(instance.id, true)
    sdk.client.local
      .disconnect({ providerID, directory: sdk.directory })
      .then(() => {
        setLocalConfig((prev) => new Map(prev).set(instance.id, null))
        showToast({
          variant: "success",
          icon: "circle-check",
          title: `Removed ${instance.name}`,
          description: "Restart OpenCode to apply changes.",
        })
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        showToast({ title: `Failed to remove ${instance.name}`, description: msg })
      })
      .finally(() => setInstancePending(instance.id, false))
  }

  function addAll() {
    instances()
      .filter((i) => !isConfigured(i))
      .forEach((i) => addProvider(i))
  }

  const unconfiguredCount = () => instances().filter((i) => !isConfigured(i)).length

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label="Go back"
        />
      }
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <Icon name="server" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">Local providers</div>
        </div>

        <div class="px-2.5 flex flex-col gap-4">
          <div class="text-14-regular text-text-base">
            Scan your local network for llama-swap instances via mDNS and add them as providers.
          </div>

          <div class="flex items-center gap-3">
            <Button
              size="small"
              variant="primary"
              onClick={scan}
              disabled={scanState() === "scanning"}
              icon="magnifying-glass"
            >
              {scanState() === "scanning" ? "Scanning…" : scanState() === "idle" ? "Scan" : "Scan again"}
            </Button>
            <Show when={scanState() === "done" && unconfiguredCount() > 1}>
              <Button size="small" variant="ghost" onClick={addAll}>
                Add all ({unconfiguredCount()})
              </Button>
            </Show>
          </div>

          <Switch>
            <Match when={scanState() === "scanning"}>
              <div class="flex items-center gap-x-2 text-14-regular text-text-base">
                <Spinner />
                <span>Scanning local network…</span>
              </div>
            </Match>

            <Match when={scanState() === "error"}>
              <div class="flex items-center gap-x-2 text-14-regular text-text-critical-base">
                <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                <span>{errorMsg()}</span>
              </div>
            </Match>

            <Match when={scanState() === "done" && instances().length === 0}>
              <div class="text-14-regular text-text-weak">No local instances found.</div>
            </Match>

            <Match when={scanState() === "done" && instances().length > 0}>
              <div class="flex flex-col gap-2">
                <For each={instances()}>
                  {(instance) => (
                    <div class="flex items-center justify-between gap-3 px-2.5 py-2 rounded-md bg-surface-base">
                      <div class="flex flex-col gap-0.5 min-w-0">
                        <span class="text-14-medium text-text-strong truncate">{instance.name}</span>
                        <span class="text-12-regular text-text-weak truncate">
                          {instance.host}:{instance.port}
                          <Show when={instance.models.length > 0}>
                            {" "}· {instance.models.length} model{instance.models.length !== 1 ? "s" : ""}
                          </Show>
                        </span>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <Show when={isConfigured(instance)}>
                          <span class="text-12-regular text-text-success-base flex items-center gap-1">
                            <Icon name="circle-check" class="size-3.5 text-icon-success-base" />
                            Added
                          </span>
                          <Button
                            size="small"
                            variant="ghost"
                            disabled={pending().has(instance.id)}
                            onClick={() => removeProvider(instance)}
                          >
                            Remove
                          </Button>
                        </Show>
                        <Show when={!isConfigured(instance)}>
                          <Button
                            size="small"
                            variant="primary"
                            disabled={pending().has(instance.id)}
                            onClick={() => addProvider(instance)}
                          >
                            {pending().has(instance.id) ? "Adding…" : "Add"}
                          </Button>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  )
}
