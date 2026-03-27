import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, For, Show, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { type FormState, headerRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"
import { DialogSelectProvider } from "./dialog-select-provider"

type Props = {
  back?: "providers" | "close"
  edit?: boolean
  providerID?: string
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const existingConfig = createMemo(() => {
    if (!props.edit || !props.providerID) return undefined
    return globalSync.data.config.provider?.[props.providerID]
  })

  const existingProvider = createMemo(() => {
    if (!props.edit || !props.providerID) return undefined
    return globalSync.data.provider.all.find((p) => p.id === props.providerID) as { key?: string } | undefined
  })

  const existingModels = createMemo(() => {
    const config = existingConfig()
    if (!config?.models) return undefined
    return Object.entries(config.models)
  })

  const existingHeaders = createMemo(() => {
    const options = existingConfig()?.options as { headers?: Record<string, string> } | undefined
    if (!options?.headers) return undefined
    return Object.entries(options.headers)
  })

  const [form, setForm] = createStore<FormState>({
    providerID: props.providerID ?? "",
    name: existingConfig()?.name ?? "",
    baseURL: (existingConfig()?.options as { baseURL?: string })?.baseURL ?? existingConfig()?.api ?? "",
    apiKey: existingProvider()?.key ?? "",
    models: existingModels()
      ? existingModels()!.map(([id, m]) => ({
          row: Math.random().toString(36).slice(2),
          id,
          name: m.name ?? id,
          err: { id: undefined, name: undefined },
        }))
      : [modelRow()],
    headers: existingHeaders()
      ? existingHeaders()!.map(([key, value]) => ({
          row: Math.random().toString(36).slice(2),
          key,
          value,
          err: { key: undefined, value: undefined },
        }))
      : [headerRow()],
    err: {},
  })

  const goBack = () => {
    if (props.edit) {
      dialog.close()
      return
    }
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1 && !props.edit) return
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
    if (form.headers.length <= 1 && !props.edit) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const existingIDs = props.edit
      ? new Set(globalSync.data.provider.all.map((p) => p.id).filter((id) => id !== props.providerID))
      : new Set(globalSync.data.provider.all.map((p) => p.id))
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs: existingIDs,
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
      const disabledProviders = globalSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await globalSDK.client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await globalSync.updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      const isEdit = props.edit
      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEdit
          ? language.t("provider.edit.toast.updated.title", { provider: result.name })
          : language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: isEdit
          ? language.t("provider.edit.toast.updated.description", { provider: result.name })
          : language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <Dialog
      title={
        <Show
          when={!props.edit}
          fallback={<span class="text-16-medium text-text-strong">{language.t("provider.custom.edit.title")}</span>}
        >
          <IconButton
            tabIndex={-1}
            icon="arrow-left"
            variant="ghost"
            onClick={goBack}
            aria-label={language.t("common.goBack")}
          />
        </Show>
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <Show when={!props.edit}>
          <div class="px-2.5 flex gap-4 items-center">
            <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
            <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
          </div>
        </Show>
        <Show when={props.edit}>
          <div class="px-2.5 flex gap-4 items-center">
            <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
            <div class="text-16-medium text-text-strong">{language.t("provider.custom.edit.title")}</div>
          </div>
        </Show>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <Show when={!props.edit}>
            <p class="text-14-regular text-text-base">
              {language.t("provider.custom.description.prefix")}
              <Link href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
                {language.t("provider.custom.description.link")}
              </Link>
              {language.t("provider.custom.description.suffix")}
            </p>
          </Show>

          <div class="flex flex-col gap-4">
            <TextField
              autofocus={!props.edit}
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={props.edit ? undefined : language.t("provider.custom.field.providerID.description")}
              value={props.providerID ?? form.providerID}
              onChange={(v) => setField("providerID", v)}
              validationState={form.err.providerID ? "invalid" : undefined}
              error={form.err.providerID}
              readOnly={props.edit}
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
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
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
                    disabled={form.models.length <= 1 && !props.edit}
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
                    disabled={form.headers.length <= 1 && !props.edit}
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
