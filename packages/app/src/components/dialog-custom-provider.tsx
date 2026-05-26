import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createEffect, For, onCleanup, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { type FormState, headerRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"
import { discoverCustomProviderModels } from "./dialog-custom-provider-discovery"
import { DialogSelectProvider } from "./dialog-select-provider"

type Props = {
  back?: "providers" | "close"
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const language = useLanguage()

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  })
  const [state, setState] = createStore({
    discovering: false,
    discoveryError: "",
    manualModels: false,
    lastDiscoveredBaseURL: "",
  })

  let discoveryTimer: ReturnType<typeof setTimeout> | undefined
  let discoveryAbort: AbortController | undefined

  onCleanup(() => {
    if (discoveryTimer !== undefined) clearTimeout(discoveryTimer)
    discoveryTimer = undefined
    discoveryAbort?.abort()
    discoveryAbort = undefined
  })

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const addModel = () => {
    setState("manualModels", true)
    setState("discoveryError", "")
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setState("manualModels", true)
    setState("discoveryError", "")
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    if (key === "baseURL" || key === "apiKey") {
      cancelDiscovery()
    }
    setForm(key, value)
    if (key === "apiKey") {
      setState("discoveryError", "")
      return
    }
    if (key === "baseURL") {
      setState("discoveryError", "")
    }
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    setState("manualModels", true)
    setState("discoveryError", "")
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    cancelDiscovery()
    setState("discoveryError", "")
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const cancelDiscovery = () => {
    if (discoveryTimer !== undefined) clearTimeout(discoveryTimer)
    discoveryTimer = undefined
    discoveryAbort?.abort()
    discoveryAbort = undefined
  }

  const buildHeaders = () => {
    const headers = new Headers()
    for (const row of form.headers) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (!key || !value) continue
      headers.set(key, value)
    }

    const apiKey = form.apiKey.trim()
    if (apiKey && !headers.has("authorization")) {
      const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
      if (!env) headers.set("Authorization", `Bearer ${apiKey}`)
    }

    return headers
  }

  const applyModels = (models: Array<{ id: string; name: string }>) => {
    setForm(
      "models",
      models.map((model) => ({
        ...modelRow(),
        id: model.id,
        name: model.name,
      })),
    )
  }

  const toErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message
    return String(error)
  }

  const discoverModels = async (opts?: { force?: boolean; notify?: boolean }) => {
    const baseURL = form.baseURL.trim()
    if (!baseURL) return false
    if (!opts?.force && state.manualModels && state.lastDiscoveredBaseURL === baseURL) return false

    cancelDiscovery()
    const controller = new AbortController()
    discoveryAbort = controller
    setState("discovering", true)
    setState("discoveryError", "")

    try {
      const models = await discoverCustomProviderModels({
        baseURL,
        apiKey: form.apiKey.trim(),
        headers: Object.fromEntries(buildHeaders().entries()),
        fetcher: platform.fetch ?? fetch,
        fetchJson: platform.fetchJson,
        signal: controller.signal,
      })

      if (controller.signal.aborted) return false

      batch(() => {
        applyModels(models)
        setState("manualModels", false)
        setState("lastDiscoveredBaseURL", baseURL)
      })
      return true
    } catch (error) {
      if (controller.signal.aborted) return false
      const message = toErrorMessage(error)
      setState("discoveryError", message)
      if (opts?.notify) {
        showToast({ title: language.t("common.requestFailed"), description: message })
      }
      return false
    } finally {
      if (discoveryAbort === controller) {
        discoveryAbort = undefined
        setState("discovering", false)
      }
    }
  }

  createEffect(() => {
    const baseURL = form.baseURL.trim()
    if (!baseURL) return
    if (state.manualModels && state.lastDiscoveredBaseURL === baseURL) return

    if (discoveryTimer !== undefined) clearTimeout(discoveryTimer)
    discoveryTimer = setTimeout(() => {
      discoveryTimer = undefined
      void discoverModels()
    }, 350)

    onCleanup(() => {
      if (discoveryTimer !== undefined) clearTimeout(discoveryTimer)
      discoveryTimer = undefined
    })
  })

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: serverSync.data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(serverSync.data.provider.all.keys()),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      const disabledProviders = serverSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await serverSDK.client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await serverSync.updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = async (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    if (!state.manualModels) {
      const discovered = await discoverModels({ force: true, notify: true })
      if (!discovered) return
    }

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

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
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            {language.t("provider.custom.description.prefix")}
            <Link href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
              {language.t("provider.custom.description.link")}
            </Link>
            {language.t("provider.custom.description.suffix")}
          </p>

          <div class="flex flex-col gap-4">
            <TextField
              autofocus
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={language.t("provider.custom.field.providerID.description")}
              value={form.providerID}
              onChange={(v) => setField("providerID", v)}
              validationState={form.err.providerID ? "invalid" : undefined}
              error={form.err.providerID}
            />
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              value={form.name}
              onChange={(v) => setField("name", v)}
              validationState={form.err.name ? "invalid" : undefined}
              error={form.err.name}
            />
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              description={language.t("provider.custom.field.baseURL.description")}
              value={form.baseURL}
              onChange={(v) => setField("baseURL", v)}
              validationState={form.err.baseURL ? "invalid" : undefined}
              error={form.err.baseURL}
            />
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
            />
          </div>

          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
              <div class="flex items-center gap-3">
                <Show when={state.discovering}>
                  <span class="flex items-center gap-2 text-12-regular text-text-weak">
                    <Spinner class="size-3.5" />
                    {language.t("common.loading")}
                  </span>
                </Show>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={() => void discoverModels({ force: true, notify: true })}
                  disabled={state.discovering}
                >
                  {language.t("provider.custom.models.refresh")}
                </Button>
              </div>
            </div>
            <Show when={state.discoveryError}>
              <div class="text-12-regular text-text-danger-base">{state.discoveryError}</div>
            </Show>
            <For each={form.models}>
              {(m, i) => (
                <div class="flex gap-2 items-start" data-row={m.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModel(i(), "id", v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setModel(i(), "name", v)}
                      validationState={m.err.name ? "invalid" : undefined}
                      error={m.err.name}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
              {language.t("provider.custom.models.add")}
            </Button>
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
            <For each={form.headers}>
              {(h, i) => (
                <div class="flex gap-2 items-start" data-row={h.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setHeader(i(), "key", v)}
                      validationState={h.err.key ? "invalid" : undefined}
                      error={h.err.key}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setHeader(i(), "value", v)}
                      validationState={h.err.value ? "invalid" : undefined}
                      error={h.err.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
