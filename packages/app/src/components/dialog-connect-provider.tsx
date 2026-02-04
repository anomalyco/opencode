import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { iife } from "@opencode-ai/util/iife"
import { createMemo, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { DialogSelectModel } from "./dialog-select-model"
import { DialogSelectProvider } from "./dialog-select-provider"

export function DialogConnectProvider(props: { provider: string }) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()

  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }

  onCleanup(() => {
    alive.value = false
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const provider = createMemo(() => globalSync.data.provider.all.find((x) => x.id === props.provider)!)
  const methods = createMemo(
    () =>
      globalSync.data.provider_auth[props.provider] ?? [
        {
          type: "api",
          label: language.t("provider.connect.method.apiKey"),
        },
      ],
  )
  const [store, setStore] = createStore({
    methodIndex: undefined as undefined | number,
    authorization: undefined as undefined | ProviderAuthAuthorization,
    state: "pending" as undefined | "pending" | "complete" | "error",
    error: undefined as string | undefined,
  })

  const method = createMemo(() => (store.methodIndex !== undefined ? methods().at(store.methodIndex!) : undefined))

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "api") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  async function selectMethod(index: number) {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    const method = methods()[index]
    setStore(
      produce((draft) => {
        draft.methodIndex = index
        draft.authorization = undefined
        draft.state = undefined
        draft.error = undefined
      }),
    )

    if (method.type === "oauth") {
      setStore("state", "pending")
      const start = Date.now()
      await globalSDK.client.provider.oauth
        .authorize(
          {
            providerID: props.provider,
            method: index,
          },
          { throwOnError: true },
        )
        .then((x) => {
          if (!alive.value) return
          const elapsed = Date.now() - start
          const delay = 1000 - elapsed

          if (delay > 0) {
            if (timer.current !== undefined) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              timer.current = undefined
              if (!alive.value) return
              setStore("state", "complete")
              setStore("authorization", x.data!)
            }, delay)
            return
          }
          setStore("state", "complete")
          setStore("authorization", x.data!)
        })
        .catch((e) => {
          if (!alive.value) return
          setStore("state", "error")
          setStore("error", String(e))
        })
    }
  }

  let listRef: ListRef | undefined
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      return
    }
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  onMount(() => {
    if (methods().length === 1) {
      selectMethod(0)
    }
    document.addEventListener("keydown", handleKey)
    onCleanup(() => {
      document.removeEventListener("keydown", handleKey)
    })
  })

  async function complete() {
    await globalSDK.client.global.dispose()
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
      description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
    })
  }

  function goBack() {
    if (methods().length === 1) {
      dialog.show(() => <DialogSelectProvider />)
      return
    }
    if (store.authorization) {
      setStore("authorization", undefined)
      setStore("methodIndex", undefined)
      return
    }
    if (store.methodIndex) {
      setStore("methodIndex", undefined)
      return
    }
    dialog.show(() => <DialogSelectProvider />)
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
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.provider as IconName} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            <Switch>
              <Match when={props.provider === "anthropic" && method()?.label?.toLowerCase().includes("max")}>
                {language.t("provider.connect.title.anthropicProMax")}
              </Match>
              <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
            </Switch>
          </div>
        </div>
        <div class="px-2.5 pb-10 flex flex-col gap-6">
          <Switch>
            <Match when={store.methodIndex === undefined}>
              <div class="text-14-regular text-text-base">
                {language.t("provider.connect.selectMethod", { provider: provider().name })}
              </div>
              <div class="">
                <List
                  ref={(ref) => {
                    listRef = ref
                  }}
                  items={methods}
                  key={(m) => m?.label}
                  onSelect={async (method, index) => {
                    if (!method) return
                    selectMethod(index)
                  }}
                >
                  {(i) => (
                    <div class="w-full flex items-center gap-x-2">
                      <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                        <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                      </div>
                      <span>{methodLabel(i)}</span>
                    </div>
                  )}
                </List>
              </div>
            </Match>
            <Match when={store.state === "pending"}>
              <div class="text-14-regular text-text-base">
                <div class="flex items-center gap-x-2">
                  <Spinner />
                  <span>{language.t("provider.connect.status.inProgress")}</span>
                </div>
              </div>
            </Match>
            <Match when={store.state === "error"}>
              <div class="text-14-regular text-text-base">
                <div class="flex items-center gap-x-2">
                  <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                  <span>{language.t("provider.connect.status.failed", { error: store.error ?? "" })}</span>
                </div>
              </div>
            </Match>
            <Match when={method()?.type === "api"}>
              {iife(() => {
                const prompts = method()?.prompts

                const [formStore, setFormStore] = createStore<{
                  values: Record<string, string>
                  errors: Record<string, string>
                }>({
                  values: {},
                  errors: {},
                })

                async function handleSubmit(e: SubmitEvent) {
                  e.preventDefault()

                  const form = e.currentTarget as HTMLFormElement
                  const formData = new FormData(form)
                  const inputs: Record<string, string> = {}

                  if (prompts && prompts.length > 0) {
                    const newErrors: Record<string, string> = {}
                    let hasError = false

                    for (const prompt of prompts) {
                      const value = formData.get(prompt.key) as string
                      inputs[prompt.key] = value

                      if (prompt.validate) {
                        const error = prompt.validate(value)
                        if (error) {
                          newErrors[prompt.key] = error
                          hasError = true
                        }
                      } else if (!value?.trim()) {
                        newErrors[prompt.key] = language.t("provider.connect.fieldRequired")
                        hasError = true
                      }
                    }

                    if (hasError) {
                      setFormStore("errors", newErrors)
                      return
                    }
                  } else {
                    const apiKey = formData.get("apiKey") as string
                    if (!apiKey?.trim()) {
                      setFormStore("errors", { apiKey: language.t("provider.connect.apiKey.required") })
                      return
                    }
                    inputs.apiKey = apiKey
                  }

                  setFormStore("errors", {})
                  await globalSDK.client.auth.set({
                    providerID: props.provider,
                    auth: {
                      type: "api",
                      data: inputs,
                    },
                  })
                  await complete()
                }

                return (
                  <div class="flex flex-col gap-6">
                    <Switch>
                      <Match when={provider().id === "opencode"}>
                        <div class="flex flex-col gap-4">
                          <div class="text-14-regular text-text-base">
                            {language.t("provider.connect.opencodeZen.line1")}
                          </div>
                          <div class="text-14-regular text-text-base">
                            {language.t("provider.connect.opencodeZen.line2")}
                          </div>
                          <div class="text-14-regular text-text-base">
                            {language.t("provider.connect.opencodeZen.visit.prefix")}
                            <Link href="https://opencode.ai/zen" tabIndex={-1}>
                              {language.t("provider.connect.opencodeZen.visit.link")}
                            </Link>
                            {language.t("provider.connect.opencodeZen.visit.suffix")}
                          </div>
                        </div>
                      </Match>
                      <Match when={true}>
                        <div class="text-14-regular text-text-base">
                          {language.t("provider.connect.apiKey.description", { provider: provider().name })}
                        </div>
                      </Match>
                    </Switch>
                    <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
                      <Switch>
                        <Match when={prompts && prompts.length > 0}>
                          <For each={prompts}>
                            {(prompt) => (
                              <Show when={!prompt.condition || prompt.condition(formStore.values)}>
                                <Switch
                                  fallback={
                                    <TextField
                                      autofocus={prompts![0] === prompt}
                                      type="text"
                                      label={prompt.message}
                                      placeholder={prompt.placeholder}
                                      name={prompt.key}
                                      value={formStore.values[prompt.key] || ""}
                                      onChange={(value) => setFormStore("values", prompt.key, value)}
                                      validationState={formStore.errors[prompt.key] ? "invalid" : undefined}
                                      error={formStore.errors[prompt.key]}
                                    />
                                  }
                                >
                                  <Match when={prompt.type === "select"}>
                                    <div class="flex flex-col gap-4">
                                      <label class="text-14-regular text-text-base">{prompt.message}</label>
                                      <select
                                        name={prompt.key}
                                        value={formStore.values[prompt.key] || ""}
                                        onChange={(e) => setFormStore("values", prompt.key, e.currentTarget.value)}
                                        class="w-full h-10 px-3 rounded-lg bg-input-base border-border-weak-base border text-text-base text-14-regular focus:outline-none focus:ring-2 focus:ring-primary"
                                      >
                                        <For each={prompt.options}>
                                          {(option) => (
                                            <option value={option.value}>
                                              {option.label}
                                              {option.hint && <span class="text-text-weak"> - {option.hint}</span>}
                                            </option>
                                          )}
                                        </For>
                                      </select>
                                      {formStore.errors[prompt.key] && (
                                        <div class="text-14-regular text-text-critical">
                                          {formStore.errors[prompt.key]}
                                        </div>
                                      )}
                                    </div>
                                  </Match>
                                </Switch>
                              </Show>
                            )}
                          </For>
                        </Match>
                        <Match when={true}>
                          <TextField
                            autofocus
                            type="text"
                            label={language.t("provider.connect.apiKey.label", { provider: provider().name })}
                            placeholder={language.t("provider.connect.apiKey.placeholder")}
                            name="apiKey"
                            value={formStore.values.apiKey || ""}
                            onChange={(value) => setFormStore("values", "apiKey", value)}
                            validationState={formStore.errors.apiKey ? "invalid" : undefined}
                            error={formStore.errors.apiKey}
                          />
                        </Match>
                      </Switch>
                      <Button class="w-auto" type="submit" size="large" variant="primary">
                        {language.t("common.submit")}
                      </Button>
                    </form>
                  </div>
                )
              })}
            </Match>
            <Match when={method()?.type === "oauth"}>
              <Switch>
                <Match when={store.authorization?.method === "code"}>
                  {iife(() => {
                    const [formStore, setFormStore] = createStore({
                      value: "",
                      error: undefined as string | undefined,
                    })

                    onMount(() => {
                      if (store.authorization?.method === "code" && store.authorization?.url) {
                        platform.openLink(store.authorization.url)
                      }
                    })

                    async function handleSubmit(e: SubmitEvent) {
                      e.preventDefault()

                      const form = e.currentTarget as HTMLFormElement
                      const formData = new FormData(form)
                      const code = formData.get("code") as string

                      if (!code?.trim()) {
                        setFormStore("error", language.t("provider.connect.oauth.code.required"))
                        return
                      }

                      setFormStore("error", undefined)
                      const result = await globalSDK.client.provider.oauth
                        .callback({
                          providerID: props.provider,
                          method: store.methodIndex,
                          code,
                        })
                        .then((value) =>
                          value.error ? { ok: false as const, error: value.error } : { ok: true as const },
                        )
                        .catch((error) => ({ ok: false as const, error }))
                      if (result.ok) {
                        await complete()
                        return
                      }
                      const message = result.error instanceof Error ? result.error.message : String(result.error)
                      setFormStore("error", message || language.t("provider.connect.oauth.code.invalid"))
                    }

                    return (
                      <div class="flex flex-col gap-6">
                        <div class="text-14-regular text-text-base">
                          {language.t("provider.connect.oauth.code.visit.prefix")}
                          <Link href={store.authorization!.url}>
                            {language.t("provider.connect.oauth.code.visit.link")}
                          </Link>
                          {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
                        </div>
                        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
                          <TextField
                            autofocus
                            type="text"
                            label={language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
                            placeholder={language.t("provider.connect.oauth.code.placeholder")}
                            name="code"
                            value={formStore.value}
                            onChange={setFormStore.bind(null, "value")}
                            validationState={formStore.error ? "invalid" : undefined}
                            error={formStore.error}
                          />
                          <Button class="w-auto" type="submit" size="large" variant="primary">
                            {language.t("common.submit")}
                          </Button>
                        </form>
                      </div>
                    )
                  })}
                </Match>
                <Match when={store.authorization?.method === "auto"}>
                  {iife(() => {
                    const code = createMemo(() => {
                      const instructions = store.authorization?.instructions
                      if (instructions?.includes(":")) {
                        return instructions?.split(":")[1]?.trim()
                      }
                      return instructions
                    })

                    onMount(() => {
                      void (async () => {
                        if (store.authorization?.url) {
                          platform.openLink(store.authorization.url)
                        }

                        const result = await globalSDK.client.provider.oauth
                          .callback({
                            providerID: props.provider,
                            method: store.methodIndex,
                          })
                          .then((value) =>
                            value.error ? { ok: false as const, error: value.error } : { ok: true as const },
                          )
                          .catch((error) => ({ ok: false as const, error }))

                        if (!alive.value) return

                        if (!result.ok) {
                          const message = result.error instanceof Error ? result.error.message : String(result.error)
                          setStore("state", "error")
                          setStore("error", message)
                          return
                        }

                        await complete()
                      })()
                    })

                    return (
                      <div class="flex flex-col gap-6">
                        <div class="text-14-regular text-text-base">
                          {language.t("provider.connect.oauth.auto.visit.prefix")}
                          <Link href={store.authorization!.url}>
                            {language.t("provider.connect.oauth.auto.visit.link")}
                          </Link>
                          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: provider().name })}
                        </div>
                        <TextField
                          label={language.t("provider.connect.oauth.auto.confirmationCode")}
                          class="font-mono"
                          value={code()}
                          readOnly
                          copyable
                        />
                        <div class="text-14-regular text-text-base flex items-center gap-4">
                          <Spinner />
                          <span>{language.t("provider.connect.status.waiting")}</span>
                        </div>
                      </div>
                    )
                  })}
                </Match>
              </Switch>
            </Match>
          </Switch>
        </div>
      </div>
    </Dialog>
  )
}
