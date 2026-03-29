import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { DialogSelectProvider } from "./dialog-select-provider"

type Props = {
  back?: "providers" | "close"
}

const NINEROUTER_ID = "9router"
const NINEROUTER_NAME = "9Router"
const DEFAULT_BASE_URL = "http://localhost:20123/v1"

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; models: string[] }

export function DialogConnect9Router(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [baseURL, setBaseURL] = createSignal(DEFAULT_BASE_URL)
  const [urlErr, setUrlErr] = createSignal<string | undefined>()
  const [fetchState, setFetchState] = createStore<FetchState>({ status: "idle" })
  const [selected, setSelected] = createSignal<Set<string>>(new Set())

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const fetchModels = async () => {
    const url = baseURL().trim()
    if (!url || !/^https?:\/\//.test(url)) {
      setUrlErr("A valid http/https URL is required")
      return
    }
    setUrlErr(undefined)
    setFetchState({ status: "loading" })
    setSelected(new Set<string>())

    try {
      // Strip trailing slash, then append /models
      const modelsURL = url.replace(/\/+$/, "") + "/models"
      const res = await fetch(modelsURL)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const json = await res.json()
      const ids: string[] = (json?.data ?? []).map((m: any) => String(m.id)).filter(Boolean)
      if (ids.length === 0) throw new Error("No models returned by server")
      setFetchState({ status: "done", models: ids })
      setSelected(new Set(ids)) // select all by default
    } catch (e) {
      setFetchState({
        status: "error",
        message: e instanceof Error ? e.message : "Failed to fetch models",
      })
    }
  }

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const url = baseURL().trim()
      if (!url || !/^https?:\/\//.test(url)) {
        setUrlErr("A valid http/https URL is required")
        return null
      }
      const models = fetchState.status === "done" ? fetchState.models : []
      const chosenIDs = models.filter((id) => selected().has(id))
      if (chosenIDs.length === 0) {
        showToast({ title: "Select at least one model" })
        return null
      }

      const modelConfig: Record<string, { name: string }> = {}
      for (const id of chosenIDs) {
        modelConfig[id] = { name: id }
      }

      const disabledProviders = globalSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== NINEROUTER_ID)

      await globalSync.updateConfig({
        provider: {
          [NINEROUTER_ID]: {
            npm: "@ai-sdk/openai-compatible",
            name: NINEROUTER_NAME,
            options: { baseURL: url, apiKey: "9router" },
            models: modelConfig,
          },
        },
        disabled_providers: nextDisabled,
      })
      return { name: NINEROUTER_NAME, count: chosenIDs.length }
    },
    onSuccess: async (result) => {
      if (!result) return
      await globalSDK.client.global.dispose()
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: `Connected to ${result.name}`,
        description: `${result.count} model${result.count !== 1 ? "s" : ""} registered`,
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const canSave = () =>
    fetchState.status === "done" && selected().size > 0 && !saveMutation.isPending

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[70vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="openrouter" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">Connect 9Router</div>
        </div>

        <div class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            9Router is a local OpenAI-compatible proxy. Enter the URL of your running 9Router
            container and test the connection — available models will appear automatically.
          </p>

          <div class="flex gap-2 items-end">
            <div class="flex-1">
              <TextField
                autofocus
                label="9Router URL"
                placeholder={DEFAULT_BASE_URL}
                value={baseURL()}
                onChange={(v) => {
                  setBaseURL(v)
                  setUrlErr(undefined)
                  setFetchState({ status: "idle" })
                  setSelected(new Set<string>())
                }}
                validationState={urlErr() ? "invalid" : undefined}
                error={urlErr()}
              />
            </div>
            <Button
              variant="secondary"
              onClick={fetchModels}
              disabled={fetchState.status === "loading"}
            >
              <Show when={fetchState.status === "loading"} fallback="Test Connection">
                <Spinner />
              </Show>
            </Button>
          </div>

          <Switch>
            <Match when={fetchState.status === "error"}>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-text-critical shrink-0" />
                <p class="text-13-regular text-text-critical">
                  {(fetchState as Extract<FetchState, { status: "error" }>).message}
                </p>
              </div>
            </Match>
            <Match when={fetchState.status === "done"}>
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full bg-accent-base shrink-0" />
                <p class="text-13-regular text-text-base">
                  Connected — {(fetchState as Extract<FetchState, { status: "done" }>).models.length} models available
                </p>
              </div>
            </Match>
          </Switch>

          <Show when={fetchState.status === "done"}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-13-medium text-text-strong">
                  Available Models ({(fetchState as Extract<FetchState, { status: "done" }>).models.length})
                </span>
                <button
                  type="button"
                  class="text-12-regular text-text-weak hover:text-text-base transition-colors"
                  onClick={() => {
                    const all = (fetchState as Extract<FetchState, { status: "done" }>).models
                    setSelected(selected().size === all.length ? new Set<string>() : new Set<string>(all))
                  }}
                >
                  {selected().size ===
                  (fetchState as Extract<FetchState, { status: "done" }>).models.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>
              <div class="flex flex-col gap-1 max-h-48 overflow-y-auto bg-surface-base rounded-lg p-2">
                <For each={(fetchState as Extract<FetchState, { status: "done" }>).models}>
                  {(id) => (
                    <label class="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected().has(id)}
                        onChange={() => toggleModel(id)}
                        class="accent-accent-base"
                      />
                      <span class="text-13-regular text-text-base">{id}</span>
                    </label>
                  )}
                </For>
              </div>
              <p class="text-12-regular text-text-weak">{selected().size} model{selected().size !== 1 ? "s" : ""} selected</p>
            </div>
          </Show>

          <Show when={fetchState.status === "done"}>
            <div class="flex self-start">
              <Button onClick={() => saveMutation.mutate()} disabled={!canSave()}>
                {saveMutation.isPending ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
