import type { ProviderAuthMethod } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { createEffect, createMemo, Match, onMount, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Link } from "@/components/link"
import { useConnectProvider } from "./use-connect-provider"
import { useLanguage } from "@/context/language"

export function DialogConnectProvider(props: { provider: string }) {
  const language = useLanguage()
  const flow = useConnectProvider(props.provider)
  const provider = flow.provider
  const screen = flow.screen
  const selectedMethod = createMemo(() => {
    const value = screen()
    if (!("method" in value)) return
    return value.method
  })
  const methods = createMemo(() => {
    const value = screen()
    if (value.type !== "select") return []
    return value.methods
  })
  const errorMessage = createMemo(() => {
    const value = screen()
    if (value.type !== "error") return ""
    return value.message
  })

  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "api") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  function OAuthPromptsView() {
    const [formStore, setFormStore] = createStore({
      value: {} as Record<string, string>,
      index: 0,
    })

    const prompts = createMemo<NonNullable<ProviderAuthMethod["prompts"]>>(() => {
      const value = screen()
      if (value.type !== "prompts") return []
      return value.prompts
    })
    const matches = (prompt: NonNullable<ReturnType<typeof prompts>[number]>, value: Record<string, string>) => {
      if (!prompt.when) return true
      const actual = value[prompt.when.key]
      if (actual === undefined) return false
      return prompt.when.op === "eq" ? actual === prompt.when.value : actual !== prompt.when.value
    }
    const current = createMemo(() => {
      const all = prompts()
      const index = all.findIndex((prompt, index) => index >= formStore.index && matches(prompt, formStore.value))
      if (index === -1) return
      return {
        index,
        prompt: all[index],
      }
    })
    const valid = createMemo(() => {
      const item = current()
      if (!item || item.prompt.type !== "text") return false
      const value = formStore.value[item.prompt.key] ?? ""
      return value.trim().length > 0
    })

    async function next(index: number, value: Record<string, string>) {
      const next = prompts().findIndex((prompt, i) => i > index && matches(prompt, value))
      if (next !== -1) {
        setFormStore("index", next)
        return
      }
      await flow.submitPrompts(value)
    }

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()
      const item = current()
      if (!item || item.prompt.type !== "text") return
      if (!valid()) return
      await next(item.index, formStore.value)
    }

    const item = () => current()
    const text = createMemo(() => {
      const prompt = item()?.prompt
      if (!prompt || prompt.type !== "text") return
      return prompt
    })
    const select = createMemo(() => {
      const prompt = item()?.prompt
      if (!prompt || prompt.type !== "select") return
      return prompt
    })

    return (
      <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
        <Switch>
          <Match when={item()?.prompt.type === "text"}>
            <TextField
              type="text"
              label={text()?.message ?? ""}
              placeholder={text()?.placeholder}
              value={text() ? (formStore.value[text()!.key] ?? "") : ""}
              onChange={(value) => {
                const prompt = text()
                if (!prompt) return
                setFormStore("value", prompt.key, value)
              }}
            />
            <Button class="w-auto" type="submit" size="large" variant="primary" disabled={!valid()}>
              {language.t("common.continue")}
            </Button>
          </Match>
          <Match when={item()?.prompt.type === "select"}>
            <div class="w-full flex flex-col gap-1.5">
              <div class="text-14-regular text-text-base">{select()?.message}</div>
              <div>
                <List
                  items={select()?.options ?? []}
                  key={(x) => x.value}
                  current={select()?.options.find((x) => x.value === formStore.value[select()!.key])}
                  onSelect={(value) => {
                    if (!value) return
                    const prompt = select()
                    if (!prompt) return
                    const nextValue = {
                      ...formStore.value,
                      [prompt.key]: value.value,
                    }
                    setFormStore("value", prompt.key, value.value)
                    void next(item()!.index, nextValue)
                  }}
                >
                  {(option) => (
                    <div class="w-full flex items-center gap-x-2">
                      <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                        <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                      </div>
                      <span>{option.label}</span>
                      <span class="text-14-regular text-text-weak">{option.hint}</span>
                    </div>
                  )}
                </List>
              </div>
            </div>
          </Match>
        </Switch>
      </form>
    )
  }

  let listRef: ListRef | undefined
  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      return
    }
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  let auto = false
  createEffect(() => {
    if (auto) return
    const value = screen()
    if (value.type === "select" && value.methods.length === 1) {
      auto = true
      void flow.chooseMethod(0)
    }
  })

  function MethodSelection() {
    return (
      <>
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.selectMethod", { provider: provider().name })}
        </div>
        <div>
          <List
            ref={(ref) => {
              listRef = ref
            }}
            items={methods}
            key={(m) => m?.label}
            onSelect={async (selected, index) => {
              if (!selected) return
              void flow.chooseMethod(index)
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
      </>
    )
  }

  function ApiAuthView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      const form = e.currentTarget as HTMLFormElement
      const formData = new FormData(form)
      const apiKey = formData.get("apiKey") as string

      if (!apiKey?.trim()) {
        setFormStore("error", language.t("provider.connect.apiKey.required"))
        return
      }

      setFormStore("error", undefined)
      await flow.submitApiKey(apiKey)
    }

    return (
      <div class="flex flex-col gap-6">
        <Switch>
          <Match when={provider().id === "opencode"}>
            <div class="flex flex-col gap-4">
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line1")}</div>
              <div class="text-14-regular text-text-base">{language.t("provider.connect.opencodeZen.line2")}</div>
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
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.apiKey.label", { provider: provider().name })}
            placeholder={language.t("provider.connect.apiKey.placeholder")}
            name="apiKey"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthCodeView() {
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })
    const oauth = createMemo(() => {
      const value = screen()
      if (value.type !== "oauthCode") return
      return value
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
      await flow.completeOAuth(code, {
        fallback: language.t("provider.connect.oauth.code.invalid"),
        onError: (error) => setFormStore("error", error),
      })
    }

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <Link href={oauth()?.authorization.url ?? ""}>{language.t("provider.connect.oauth.code.visit.link")}</Link>
          {language.t("provider.connect.oauth.code.visit.suffix", { provider: provider().name })}
        </div>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.oauth.code.label", { method: oauth()?.method.label ?? "" })}
            placeholder={language.t("provider.connect.oauth.code.placeholder")}
            name="code"
            value={formStore.value}
            onChange={(v) => setFormStore("value", v)}
            validationState={formStore.error ? "invalid" : undefined}
            error={formStore.error}
          />
          <Button class="w-auto" type="submit" size="large" variant="primary">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    const oauth = createMemo(() => {
      const value = screen()
      if (value.type !== "oauthAuto") return
      return value
    })

    onMount(() => {
      void flow.completeOAuth()
    })

    return (
      <div class="flex flex-col gap-6">
        <div class="text-14-regular text-text-base">
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <Link href={oauth()?.authorization.url ?? ""}>{language.t("provider.connect.oauth.auto.visit.link")}</Link>
          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: provider().name })}
        </div>
        <TextField
          label={language.t("provider.connect.oauth.auto.confirmationCode")}
          class="font-mono"
          value={oauth()?.code}
          readOnly
          copyable
        />
        <div class="text-14-regular text-text-base flex items-center gap-4">
          <Spinner />
          <span>{language.t("provider.connect.status.waiting")}</span>
        </div>
      </div>
    )
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={flow.goBack}
          aria-label={language.t("common.goBack")}
        />
      }
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.provider} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            <Switch>
              <Match when={props.provider === "anthropic" && selectedMethod()?.label?.toLowerCase().includes("max")}>
                {language.t("provider.connect.title.anthropicProMax")}
              </Match>
              <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
            </Switch>
          </div>
        </div>
        <div class="px-2.5 pb-10 flex flex-col gap-6">
          <div onKeyDown={handleKey} tabIndex={0} autofocus={screen().type === "select" ? true : undefined}>
            <Switch>
              <Match when={screen().type === "loading"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Spinner />
                    <span>{language.t("provider.connect.status.inProgress")}</span>
                  </div>
                </div>
              </Match>
              <Match when={screen().type === "select"}>
                <MethodSelection />
              </Match>
              <Match when={screen().type === "pending"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Spinner />
                    <span>{language.t("provider.connect.status.inProgress")}</span>
                  </div>
                </div>
              </Match>
              <Match when={screen().type === "prompts"}>
                <OAuthPromptsView />
              </Match>
              <Match when={screen().type === "error"}>
                <div class="text-14-regular text-text-base">
                  <div class="flex items-center gap-x-2">
                    <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                    <span>{language.t("provider.connect.status.failed", { error: errorMessage() })}</span>
                  </div>
                </div>
              </Match>
              <Match when={screen().type === "api"}>
                <ApiAuthView />
              </Match>
              <Match when={screen().type === "oauthCode"}>
                <OAuthCodeView />
              </Match>
              <Match when={screen().type === "oauthAuto"}>
                <OAuthAutoView />
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
