import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { For } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { DialogSelectProvider } from "./dialog-select-provider"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Props = {
  back?: "providers" | "close"
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [form, setForm] = createStore({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [{ id: "", name: "" }],
    headers: [{ key: "", value: "" }],
    saving: false,
  })

  const [errors, setErrors] = createStore({
    providerID: undefined as string | undefined,
    name: undefined as string | undefined,
    baseURL: undefined as string | undefined,
    models: [{} as { id?: string; name?: string }],
    headers: [{} as { key?: string; value?: string }],
  })

  const goBack = () => {
    if (props.back === "close") {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const addModel = () => {
    setForm(
      "models",
      produce((draft) => {
        draft.push({ id: "", name: "" })
      }),
    )
    setErrors(
      "models",
      produce((draft) => {
        draft.push({})
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((draft) => {
        draft.splice(index, 1)
      }),
    )
    setErrors(
      "models",
      produce((draft) => {
        draft.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((draft) => {
        draft.push({ key: "", value: "" })
      }),
    )
    setErrors(
      "headers",
      produce((draft) => {
        draft.push({})
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((draft) => {
        draft.splice(index, 1)
      }),
    )
    setErrors(
      "headers",
      produce((draft) => {
        draft.splice(index, 1)
      }),
    )
  }

  const validate = () => {
    const providerID = form.providerID.trim()
    const name = form.name.trim()
    const baseURL = form.baseURL.trim()
    const apiKey = form.apiKey.trim()

    const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
    const key = apiKey && !env ? apiKey : undefined

    const idError = !providerID
      ? language.t("provider.custom.error.providerID.required")
      : !PROVIDER_ID.test(providerID)
        ? language.t("provider.custom.error.providerID.format")
        : undefined

    const nameError = !name ? language.t("provider.custom.error.name.required") : undefined
    const urlError = !baseURL
      ? language.t("provider.custom.error.baseURL.required")
      : !/^https?:\/\//.test(baseURL)
        ? language.t("provider.custom.error.baseURL.format")
        : undefined

    const disabled = (globalSync.data.config.disabled_providers ?? []).includes(providerID)
    const existingProvider = globalSync.data.provider.all.find((p) => p.id === providerID)
    const existsError = idError
      ? undefined
      : existingProvider && !disabled
        ? language.t("provider.custom.error.providerID.exists")
        : undefined

    const seenModels = new Set<string>()
    const modelErrors = form.models.map((m) => {
      const id = m.id.trim()
      const modelIdError = !id
        ? language.t("provider.custom.error.required")
        : seenModels.has(id)
          ? language.t("provider.custom.error.duplicate")
          : (() => {
              seenModels.add(id)
              return undefined
            })()
      const modelNameError = !m.name.trim() ? language.t("provider.custom.error.required") : undefined
      return { id: modelIdError, name: modelNameError }
    })
    const modelsValid = modelErrors.every((m) => !m.id && !m.name)
    const models = Object.fromEntries(form.models.map((m) => [m.id.trim(), { name: m.name.trim() }]))

    const seenHeaders = new Set<string>()
    const headerErrors = form.headers.map((h) => {
      const key = h.key.trim()
      const value = h.value.trim()

      if (!key && !value) return {}
      const keyError = !key
        ? language.t("provider.custom.error.required")
        : seenHeaders.has(key.toLowerCase())
          ? language.t("provider.custom.error.duplicate")
          : (() => {
              seenHeaders.add(key.toLowerCase())
              return undefined
            })()
      const valueError = !value ? language.t("provider.custom.error.required") : undefined
      return { key: keyError, value: valueError }
    })
    const headersValid = headerErrors.every((h) => !h.key && !h.value)
    const headers = Object.fromEntries(
      form.headers
        .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
        .filter((h) => !!h.key && !!h.value)
        .map((h) => [h.key, h.value]),
    )

    setErrors(
      produce((draft) => {
        draft.providerID = idError ?? existsError
        draft.name = nameError
        draft.baseURL = urlError
        draft.models = modelErrors
        draft.headers = headerErrors
      }),
    )

    const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
    if (!ok) return

    const options = {
      baseURL,
      ...(Object.keys(headers).length ? { headers } : {}),
    }

    return {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options,
        models,
      },
    }
  }

  const save = async (e: SubmitEvent) => {
    e.preventDefault()
    if (form.saving) return

    const result = validate()
    if (!result) return

    setForm("saving", true)

    const disabledProviders = globalSync.data.config.disabled_providers ?? []
    const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

    const auth = result.key
      ? globalSDK.client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      : Promise.resolve()

    auth
      .then(() =>
        globalSync.updateConfig({ provider: { [result.providerID]: result.config }, disabled_providers: nextDisabled }),
      )
      .then(() => {
        dialog.close()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
          description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => {
        setForm("saving", false)
      })
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
              onChange={setForm.bind(null, "providerID")}
              validationState={errors.providerID ? "invalid" : undefined}
              error={errors.providerID}
            />
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              value={form.name}
              onChange={setForm.bind(null, "name")}
              validationState={errors.name ? "invalid" : undefined}
              error={errors.name}
            />
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={setForm.bind(null, "baseURL")}
              validationState={errors.baseURL ? "invalid" : undefined}
              error={errors.baseURL}
            />
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={setForm.bind(null, "apiKey")}
            />
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
            <For each={form.models}>
              {(m, i) => (
                <div class="flex gap-2 items-start">
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setForm("models", i(), "id", v)}
                      validationState={errors.models[i()]?.id ? "invalid" : undefined}
                      error={errors.models[i()]?.id}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setForm("models", i(), "name", v)}
                      validationState={errors.models[i()]?.name ? "invalid" : undefined}
                      error={errors.models[i()]?.name}
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
                <div class="flex gap-2 items-start">
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setForm("headers", i(), "key", v)}
                      validationState={errors.headers[i()]?.key ? "invalid" : undefined}
                      error={errors.headers[i()]?.key}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setForm("headers", i(), "value", v)}
                      validationState={errors.headers[i()]?.value ? "invalid" : undefined}
                      error={errors.headers[i()]?.value}
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

          <Button class="w-auto self-start" type="submit" size="large" variant="primary" disabled={form.saving}>
            {form.saving ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
