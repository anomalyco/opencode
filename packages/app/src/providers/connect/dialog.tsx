import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { List } from "@opencode/ui/list"
import { Spinner } from "@opencode/ui/spinner"
import { TextField } from "@opencode/ui/text-field"
import { DialogBody, DialogHeader, DialogTitle, Dialog } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { showToast } from "@/shell/notifications/toast"
import {
  type Component,
  createEffect,
  createMemo,
  createUniqueId,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useProviders } from "@/providers/catalog/providers"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { CustomProviderForm } from "@/providers/credentials/dialog"
import { ProviderModelGroup, ProviderModelIcon } from "@/providers/models/provider-group"
import type { ModelSelection } from "@/providers/models/selection"
import { OpenCodeLogo } from "@/providers/opencode-logo"
import { decode64 } from "@/runtime/persistence/base64"
import { SettingsList } from "@/settings/list"
import { useTabs } from "@/shell/tabs/tabs"
import {
  CONSOLE_INTEGRATION,
  CONSOLE_PROVIDERS,
  consoleIntegration,
  createProviderConnectionController,
  providerFormDefaults,
  type ProviderConnectMethod,
} from "./controller"
import { ConsoleAuthorization } from "./console"
import { authServerName, RemoteAuthNotice } from "./remote"
import "./models.css"

const CUSTOM_ID = "_custom"
type IntegrationForm = NonNullable<ProviderConnectMethod["form"]>[number]
type StringForm = Extract<IntegrationForm, { type: "string" }>

export function useProviderConnectController() {
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const reset = () => setStore("selected", undefined)

  return {
    selected: () => store.selected,
    select: (provider?: string) => setStore("selected", provider),
    reset,
  }
}

export const DialogConnectProvider: Component<{
  directory?: string
  /** Connects at the server's default Location instead of the current route's directory. */
  defaultLocation?: boolean
  controller?: ReturnType<typeof useProviderConnectController>
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: (provider: string) => void
}> = (props) => {
  const fallback = useProviderConnectController()
  const controller = props.controller ?? fallback
  const [state, setState] = createStore({
    completed: false,
    modelProvider: undefined as { id: string; name: string } | undefined,
    authorization: false,
  })
  const language = useLanguage()
  const reset = controller.reset
  const back = { current: reset }
  const consoleSelected = () => CONSOLE_PROVIDERS.has(controller.selected() ?? "")
  let focusHost: HTMLDivElement | undefined
  const holdFocus = () => focusHost?.focus({ preventScroll: true })
  const select = (provider?: string) => {
    back.current = reset
    controller.select(provider)
  }

  function Content() {
    return (
      <Switch>
        <Match when={controller.selected() === CUSTOM_ID}>
          <CustomProviderForm autofocus={false} />
        </Match>
        <Match
          keyed
          when={controller.selected() && controller.selected() !== CUSTOM_ID ? controller.selected() : undefined}
        >
          {(provider) => (
            <ProviderConnection
              provider={provider}
              directory={props.directory}
              defaultLocation={props.defaultLocation}
              onBack={reset}
              setBack={(handler) => (back.current = handler)}
              selection={props.selection}
              onDone={props.onDone ? () => setState("completed", true) : undefined}
              onConnected={() => props.onConnected?.(provider)}
              onFirstConnection={(provider) => setState("modelProvider", provider)}
              onAuthorization={(authorization) => setState("authorization", authorization)}
            />
          )}
        </Match>
        <Match when={true}>
          <ProviderPicker directory={props.directory} onSelect={select} onPrepare={holdFocus} />
        </Match>
      </Switch>
    )
  }

  return (
    <Dialog
      preventBackdropDismiss={state.authorization}
      containerClass={
        state.modelProvider
          ? "!h-[min(calc(100vh_-_16px),560px)] !w-[min(calc(100vw_-_16px),640px)]"
          : consoleSelected() && state.authorization
            ? "!h-auto !max-h-[min(calc(100vh_-_16px),560px)] !w-[min(calc(100vw_-_16px),640px)]"
            : "!h-[min(calc(100vh_-_16px),512px)] !w-[min(calc(100vw_-_16px),640px)]"
      }
      onCloseAutoFocus={(event) => {
        if (!state.completed || !props.onDone) return
        event.preventDefault()
        props.onDone()
      }}
      class="[font-family:var(--v2-font-family-sans)] [&_[data-slot=dialog-header]]:!px-5 [&_[data-slot=dialog-header-title]]:!text-[15px] [&_[data-slot=dialog-header-title]]:!tracking-[-0.13px]"
      classList={{
        "[&_[data-slot=dialog-header]]:!pt-4 [&_[data-slot=dialog-header]]:!pb-3": consoleSelected() && !state.modelProvider,
        "[&_[data-slot=dialog-header]]:!pt-5": !!state.modelProvider,
      }}
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <Switch>
          <Match when={state.modelProvider}>
            {(provider) => (
              <div class="flex items-center gap-2">
                <ProviderModelIcon provider={provider()} class="shrink-0" />
                <DialogTitle>{language.t("provider.connect.models.title", { provider: provider().name })}</DialogTitle>
              </div>
            )}
          </Match>
          <Match when={controller.selected()}>
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
              onClick={() => back.current()}
              aria-label={language.t("common.goBack")}
            >
              <Icon name="arrow-left" size="small" />
            </button>
          </Match>
          <Match when={true}>
            <DialogTitle>{language.t("command.provider.connect")}</DialogTitle>
          </Match>
        </Switch>
      </DialogHeader>
      <DialogBody
        class={`min-h-0 flex-1 overflow-hidden px-2 ${state.modelProvider || consoleSelected() ? "pb-0" : "pb-2"}`}
      >
        <div ref={focusHost} tabIndex={-1} class="flex min-h-0 flex-1 flex-col outline-none">
          <Content />
        </div>
      </DialogBody>
    </Dialog>
  )
}

function ProviderPicker(props: { directory?: string; onSelect: (provider: string) => void; onPrepare?: () => void }) {
  const integrations = useIntegrations(() => props.directory)
  const language = useLanguage()
  const [store, setStore] = createStore({
    filter: "",
    active: undefined as string | undefined,
    connecting: undefined as string | undefined,
  })
  const featured = ["opencode-go", "opencode", "anthropic", "openai", "google", "openrouter", "vercel"]
  const custom = () => ({ id: CUSTOM_ID, name: language.t("dialog.provider.custom.label") })
  // Only a stored credential hides a provider: environment and config connections can still be
  // replaced by a sign-in. OpenCode Zen and Go stay until a Console account (not a key) is connected.
  const consoleAccount = createMemo(() =>
    integrations
      .list()
      .find((integration) => integration.id === CONSOLE_INTEGRATION)
      ?.connections.some((connection) => connection.type === "credential" && connection.method === "oauth"),
  )
  const all = createMemo(() => {
    language.locale()
    const query = store.filter.trim().toLowerCase()
    const values = [
      custom(),
      ...integrations
        .list()
        .filter((integration) =>
          CONSOLE_PROVIDERS.has(integration.id)
            ? !consoleAccount()
            : !integration.connections.some((connection) => connection.type === "credential"),
        ),
    ]
    if (!query) return values
    return values.filter((provider) => `${provider.id} ${provider.name}`.toLowerCase().includes(query))
  })
  const popular = createMemo(() =>
    all()
      .filter((provider) => featured.includes(provider.id))
      .sort((a, b) => featured.indexOf(a.id) - featured.indexOf(b.id)),
  )
  const other = createMemo(() =>
    all()
      .filter((provider) => !featured.includes(provider.id))
      .sort((a, b) => {
        if (a.id === CUSTOM_ID) return -1
        if (b.id === CUSTOM_ID) return 1
        return a.name.localeCompare(b.name)
      }),
  )
  const rows = createMemo(() => [...popular(), ...other()])
  let picker: HTMLDivElement | undefined
  let search: HTMLInputElement | undefined

  onMount(() => search?.focus({ preventScroll: true }))

  const connect = (provider: string) => {
    props.onPrepare?.()
    props.onSelect(provider)
  }

  const move = (event: KeyboardEvent, direction: number) => {
    const items = rows()
    if (items.length === 0) return
    const index = items.findIndex((provider) => provider.id === store.active)
    const next = index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
    setStore("active", items[next].id)
    picker
      ?.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(items[next].id)}"]`)
      ?.focus({ preventScroll: true })
    event.preventDefault()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") return move(event, 1)
    if (event.key === "ArrowUp") return move(event, -1)
    if (event.key !== "Enter" || !store.active) return
    connect(store.active)
    event.preventDefault()
  }

  return (
    <div ref={picker} class="flex min-h-0 flex-1 flex-col gap-4" onKeyDown={handleKeyDown}>
      <div class="shrink-0 px-1 pt-px">
        <TextInput
          ref={search}
          type="search"
          class="!w-full [font-family:var(--v2-font-family-sans)]"
          leadingIcon={<Icon name="magnifying-glass" size="small" />}
          placeholder={language.t("dialog.provider.search.placeholder")}
          value={store.filter}
          onInput={(event) => {
            setStore({ filter: event.currentTarget.value, active: undefined })
          }}
        />
      </div>
      <div class="relative min-h-0 flex-1">
        <div class="flex size-full min-h-0 flex-col gap-4 overflow-y-auto pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <For
            each={[
              { title: language.t("dialog.provider.group.popular"), items: popular },
              { title: language.t("dialog.provider.group.other"), items: other },
            ]}
          >
            {(group) => (
              <Show when={group.items().length > 0}>
                <section class="flex flex-col">
                  <div class="px-3 pb-2 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-muted">
                    {group.title}
                  </div>
                  <For each={group.items()}>
                    {(provider) => (
                      <button
                        type="button"
                        data-provider-id={provider.id}
                        class="flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-[13px] leading-text-compact tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus:bg-v2-overlay-simple-overlay-hover focus:outline-none"
                        classList={{ "bg-v2-overlay-simple-overlay-hover": store.active === provider.id }}
                        onMouseEnter={() => setStore("active", provider.id)}
                        disabled={store.connecting !== undefined}
                        aria-busy={store.connecting === provider.id}
                        onClick={() => connect(provider.id)}
                      >
                        <ProviderModelIcon provider={provider} class="shrink-0 text-v2-icon-icon-base" />
                        <span class="min-w-0 truncate font-[530] text-v2-text-text-base">{provider.name}</span>
                        <Show when={CONSOLE_PROVIDERS.has(provider.id)}>
                          <span class="min-w-0 truncate font-[440] text-v2-text-text-muted">
                            {language.t(
                              provider.id === "opencode"
                                ? "dialog.provider.opencode.tagline"
                                : "dialog.provider.opencodeGo.tagline",
                            )}
                          </span>
                          <span class="flex h-4 shrink-0 items-center rounded-xs border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-03 px-1 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-muted">
                            {language.t("dialog.provider.tag.recommended")}
                          </span>
                        </Show>
                        <Show when={provider.id === CUSTOM_ID}>
                          <span class="flex h-4 shrink-0 items-center rounded-xs border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-03 px-1 text-[11px] font-[530] leading-none tracking-[0.05px] text-v2-text-text-muted">
                            {language.t("settings.providers.tag.custom")}
                          </span>
                        </Show>
                        <Show when={store.connecting === provider.id}>
                          <Spinner class="ml-auto size-4 shrink-0 text-v2-icon-icon-muted" />
                        </Show>
                      </button>
                    )}
                  </For>
                </section>
              </Show>
            )}
          </For>
          <Show when={rows().length === 0}>
            <div class="flex h-24 items-center justify-center text-[13px] font-[440] text-v2-text-text-muted">
              {language.t("dialog.provider.empty")}
            </div>
          </Show>
        </div>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{ background: "linear-gradient(to bottom, transparent, var(--v2-background-bg-layer-01))" }}
        />
      </div>
    </div>
  )
}

function ProviderConnection(props: {
  provider: string
  directory?: string
  defaultLocation?: boolean
  onBack: () => void
  setBack: (handler: () => void) => void
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: () => void
  onFirstConnection: (provider: { id: string; name: string }) => void
  onAuthorization: (authorization: boolean) => void
}) {
  const dialog = useDialog()
  const params = useParams()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useServerSDK()
  const data = useData()
  const global = useGlobal()
  const tabs = useTabs()
  // A sign-in belongs to the Location where it began, even if the route changes underneath it.
  const initialDirectory = props.defaultLocation ? undefined : (props.directory ?? decode64(params.dir))
  const directory = () => initialDirectory
  const location = () => (initialDirectory ? { directory: initialDirectory } : undefined)
  const providers = useProviders(directory)
  const integrations = useIntegrations(directory)
  const integrationID = consoleIntegration(props.provider)
  const isConsole = CONSOLE_PROVIDERS.has(props.provider)
  const remote = isConsole && authServerName(sdk.server) !== undefined
  const [state, setState] = createStore({
    copied: false,
    copyFailed: false,
    firstConnection: undefined as boolean | undefined,
    models: false,
    noModels: false,
    // The workspace providers had not loaded when the wait ran out.
    catalogPending: false,
    selectedModel: "",
    collapsed: {} as Record<string, boolean>,
  })

  const controller = createProviderConnectionController({
    provider: () => integrationID,
    // A Go service-account key still belongs to the `opencode-go` integration (zen/go/v1),
    // exactly as before; only the sign-in is shared with the Console.
    keyProvider: () => props.provider,
    directory,
    autoSelect: (methods) => {
      if (!isConsole) return undefined
      const index = methods.findIndex((method) => method.type === "oauth")
      return index === -1 ? undefined : index
    },
    prepare: isConsole ? prepareConsoleCatalog : undefined,
    pollInterval: isConsole ? 500 : undefined,
    onComplete: () => {
      props.onConnected?.()
      // The picker only lists the newest model per family by default, which hides most of
      // what a new connection just unlocked. Show everything the connected integration offers.
      global.models.show(
        connectionModels().map((model) => ({ providerID: model.providerID, modelID: model.id })),
      )
      if (state.catalogPending) {
        setState("noModels", true)
        return
      }
      if (state.firstConnection) {
        const first = connectionGroups()[0]?.models[0]
        if (first) {
          setState({ models: true, selectedModel: modelKey(first) })
          props.onFirstConnection({ id: props.provider, name: provider().name })
          return
        }
        // Keep the "connected, but no models" state visible so the workspace can be fixed.
        if (isConsole) {
          setState("noModels", true)
          return
        }
      }
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
        description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
      })
    },
  })
  // Captured before the new credential lands, so the connection itself never counts as existing.
  createEffect(() => {
    if (state.firstConnection !== undefined) return
    const existing = providers.anyConnection()
    if (existing === undefined) return
    setState("firstConnection", !existing)
  })
  const connectionProviders = createMemo(() =>
    (data.location.provider.list(location()) ?? []).filter(
      (provider) => provider.id === props.provider || provider.integrationID === integrationID,
    ),
  )
  const connectionModels = createMemo(() => {
    const ids = new Set(connectionProviders().map((provider) => provider.id))
    return (data.location.model.list(location()) ?? []).filter(
      (model) => ids.has(model.providerID) && model.enabled && model.status !== "deprecated",
    )
  })
  const connectionGroups = createMemo(() => {
    const models = connectionModels()
    return connectionProviders()
      .map((provider) => ({ provider, models: models.filter((model) => model.providerID === provider.id) }))
      .filter((group) => group.models.length > 0)
  })
  const managedProviders = createMemo(() => (isConsole ? consoleProviderGroup(connectionProviders()) : undefined))

  // The server loads the Console workspace's providers after the grant lands, so the first refresh
  // can still show only the free catalog. Poll briefly for the workspace providers before moving on.
  async function prepareConsoleCatalog(active: () => boolean) {
    if (controller.currentMethod()?.type === "key") return active()
    const loaded = () =>
      managedProviders() !== undefined || connectionProviders().some((provider) => provider.id !== "opencode")
    const deadline = Date.now() + 10_000
    while (!loaded() && active() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (!active()) return false
      data.location.provider.invalidate(location())
      data.location.model.invalidate(location())
      await Promise.all([data.location.provider.sync(location()), data.location.model.sync(location())]).catch(
        () => undefined,
      )
    }
    setState("catalogPending", !loaded())
    return active()
  }
  const connectionGroupName = (name: string) => {
    const managed = managedProviders()
    return managed ? consoleProviderName(managed, name) : name
  }
  const modelKey = (model: { providerID: string; id: string }) => `${model.providerID}:${model.id}`
  const selectedModel = () => connectionModels().find((model) => modelKey(model) === state.selectedModel)
  const copyLink = async () => {
    const url = controller.authorization()?.url
    if (!url) return
    const copied = await Promise.resolve()
      .then(() => (platform.writeClipboardText ? platform.writeClipboardText(url) : navigator.clipboard.writeText(url)))
      .then(() => true)
      .catch(() => false)
    if (controller.authorization()?.url !== url) return
    setState({ copied, copyFailed: !copied })
  }
  createEffect(() => {
    controller.authorization()?.attemptID
    setState({ copied: false, copyFailed: false })
  })
  createEffect(() => {
    const current = controller.auth.state()
    props.onAuthorization(controller.authorization() !== undefined && (current === "waiting" || current === "refreshing"))
  })
  const provider = createMemo(() => ({
    id: props.provider,
    name:
      integrations.list().find((item) => item.id === props.provider)?.name ??
      providers.all().get(props.provider)?.name ??
      controller.integration()?.name ??
      props.provider,
  }))
  const methodLabel = (value?: { type?: string; label?: string }) => {
    if (!value) return ""
    if (value.type === "key") return language.t("provider.connect.method.apiKey")
    return value.label ?? ""
  }

  const methodDetails = (value?: { type?: string; label?: string }) => {
    const label = methodLabel(value)
    const suffix = value?.label?.match(/\s+\((browser|headless)\)$/i)
    const hint = suffix?.[1]
    return {
      label: suffix ? label.slice(0, -suffix[0].length) : label,
      hint:
        hint?.toLowerCase() === "headless"
          ? language.t("provider.connect.method.headless")
          : hint?.toLowerCase() === "browser" || (!hint && value?.type === "key")
            ? language.t("provider.connect.method.browser")
            : undefined,
    }
  }
  const code = createMemo(() => {
    const authorization = controller.authorization()
    if (!authorization) return
    const userCode = new URL(authorization.url).searchParams.get("user_code")
    if (userCode) return userCode
    const instructions = authorization.instructions
    if (instructions?.includes(":")) return instructions.split(":").pop()?.trim()
    return instructions
  })
  const keyIndex = () => controller.methods().findIndex((method) => method.type === "key")
  const oauthIndex = () => controller.methods().findIndex((method) => method.type === "oauth")
  // The Console device flow owns the dialog from the first frame until the catalogs are loaded.
  const consoleSignIn = () =>
    isConsole &&
    !state.noModels &&
    controller.currentMethod()?.type !== "key" &&
    controller.auth.state() !== "error" &&
    (controller.busy() || controller.authorization()?.mode === "auto")

  function AuthFormView() {
    const defaults = providerFormDefaults(controller.currentMethod()?.form)
    const [formStore, setFormStore] = createStore({
      value: Object.fromEntries(
        Object.entries(defaults).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
      ) as Record<string, string>,
      index: 0,
    })

    const fields = createMemo<StringForm[]>(() => {
      const value = controller.currentMethod()
      return (value?.form ?? []).flatMap((field) => (field.type === "string" && !field.hidden ? [field] : []))
    })
    const matches = (field: StringForm, value: Record<string, string>) => {
      return (field.when ?? []).every((condition) => {
        const actual = value[condition.key]
        if (actual === undefined) return false
        return condition.op === "eq" ? actual === condition.value : actual !== condition.value
      })
    }
    const current = createMemo(() => {
      const all = fields()
      const index = all.findIndex((field, index) => index >= formStore.index && matches(field, formStore.value))
      if (index === -1) return undefined
      return {
        index,
        field: all[index],
      }
    })
    const valid = createMemo(() => {
      const item = current()
      if (!item || item.field.options) return false
      if (!item.field.required) return true
      return (formStore.value[item.field.key] ?? "").trim().length > 0
    })

    async function next(index: number, value: Record<string, string>) {
      const selected = controller.methodIndex()
      if (selected === undefined) return
      const next = fields().findIndex((field, i) => i > index && matches(field, value))
      if (next !== -1) {
        setFormStore("index", next)
        return
      }
      await controller.auth.select(selected, value)
    }

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()
      const item = current()
      if (!item || item.field.options) return
      if (!valid()) return
      await next(item.index, formStore.value)
    }

    const item = () => current()
    const text = createMemo(() => {
      const field = item()?.field
      if (!field || field.options) return undefined
      return field
    })
    const select = createMemo(() => {
      const field = item()?.field
      if (!field?.options) return undefined
      return field
    })

    return (
      <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4 px-3">
        <Switch>
          <Match when={item()?.field.options === undefined}>
            <TextField
              type="text"
              label={text()?.title ?? ""}
              placeholder={text()?.placeholder}
              value={text() ? (formStore.value[text()!.key] ?? "") : ""}
              onChange={(value) => {
                const field = text()
                if (!field) return
                setFormStore("value", field.key, value)
              }}
            />
            <Button class="w-auto" type="submit" size="large" variant="contrast" disabled={!valid()}>
              {language.t("common.continue")}
            </Button>
          </Match>
          <Match when={item()?.field.options !== undefined}>
            <div class="w-full flex flex-col gap-1.5">
              <div class="text-14-regular text-text-base">{select()?.title}</div>
              <div>
                <List
                  class="px-3"
                  items={select()?.options ?? []}
                  key={(x) => x.value}
                  current={select()?.options?.find((x) => x.value === formStore.value[select()!.key])}
                  onSelect={(value) => {
                    if (!value) return
                    const field = select()
                    if (!field) return
                    const nextValue = {
                      ...formStore.value,
                      [field.key]: value.value,
                    }
                    setFormStore("value", field.key, value.value)
                    void next(item()!.index, nextValue)
                  }}
                >
                  {(option) => (
                    <div class="w-full flex items-center gap-x-2">
                      <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                        <div class="w-2.5 h-0.5 ml-0 bg-icon-strong-base hidden" data-slot="list-item-extra-icon" />
                      </div>
                      <span>{option.label}</span>
                      <span class="text-14-regular text-text-weak">{option.description}</span>
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

  function goBack() {
    // The API key path for the Console is an escape hatch below the sign-in flow, so
    // "back" returns to the sign-in rather than leaving the provider.
    if (isConsole && controller.currentMethod()?.type === "key" && oauthIndex() !== -1) {
      void controller.auth.select(oauthIndex())
      return
    }
    if (!isConsole && controller.methods().length > 1 && controller.methodIndex() !== undefined) {
      controller.auth.reset()
      return
    }
    props.onBack()
  }

  props.setBack(goBack)

  function MethodSelection() {
    return (
      <div class="flex flex-col gap-2">
        <div class="px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          {language.t("provider.connect.selectMethod", { provider: provider().name })}
        </div>
        <div class="flex flex-col">
          <For each={controller.methods()}>
            {(item, index) => {
              const details = () => methodDetails(item)
              return (
                <button
                  type="button"
                  class="group flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                  onClick={() => void controller.auth.select(index())}
                >
                  <span class="flex h-2 w-4 shrink-0 items-center justify-center rounded-[1px] bg-v2-background-bg-base shadow-[var(--v2-elevation-button-neutral)]">
                    <span class="hidden h-0.5 w-2.5 bg-v2-icon-icon-base group-hover:block group-focus-visible:block" />
                  </span>
                  <span class="font-[530] text-v2-text-text-base">{details().label}</span>
                  <Show when={details().hint}>
                    {(hint) => <span class="font-[440] text-v2-text-text-muted">{hint()}</span>}
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    )
  }

  function StatusRow(input: { children: JSX.Element }) {
    return (
      <div class="flex items-center gap-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <Spinner class="size-4 shrink-0 text-v2-icon-icon-muted" />
        <span>{input.children}</span>
      </div>
    )
  }

  function ErrorRow() {
    return (
      <div class="flex flex-col items-start gap-3">
        <div class="flex items-start gap-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base">
          <Icon name="circle-ban-sign" size="small" class="mt-0.5 shrink-0 text-v2-state-fg-danger" />
          <span role="alert">
            {isConsole
              ? controller.auth.error()
              : language.t("provider.connect.status.failed", { error: controller.auth.error() ?? "" })}
          </span>
        </div>
        <Button variant="neutral" onClick={() => void controller.auth.retry()}>
          {language.t("common.retry")}
        </Button>
      </div>
    )
  }

  function ApiAuthView() {
    let apiKey: HTMLInputElement | undefined
    const errorID = createUniqueId()
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    onMount(() => {
      apiKey?.focus({ preventScroll: true })
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      if (!(e.currentTarget instanceof HTMLFormElement)) return
      const value = new FormData(e.currentTarget).get("apiKey")
      const apiKey = typeof value === "string" ? value : ""

      if (!apiKey?.trim()) {
        setFormStore("error", language.t("provider.connect.apiKey.required"))
        return
      }

      setFormStore("error", undefined)
      await controller.auth.connectKey(apiKey)
    }

    return (
      <div class="flex flex-col gap-5 px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <Show
          when={isConsole}
          fallback={language.t("provider.connect.apiKey.description", { provider: provider().name })}
        >
          <div>
            {language.t("provider.connect.console.apiKey.description")}{" "}
            <ExternalLink
              href="https://opencode.ai/console"
              class="text-v2-text-text-base focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
            >
              {language.t("provider.connect.console.apiKey.link")}
            </ExternalLink>
          </div>
        </Show>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-5 self-stretch">
          <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
            {language.t("provider.connect.apiKey.label", { provider: provider().name })}
            <TextInput
              ref={apiKey}
              class="!w-full"
              name="apiKey"
              data-input="provider-api-key"
              placeholder={language.t("provider.connect.apiKey.placeholder")}
              value={formStore.value}
              invalid={formStore.error !== undefined}
              aria-describedby={formStore.error ? errorID : undefined}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setFormStore("value", event.currentTarget.value)}
            />
          </label>
          <Show when={formStore.error}>
            {(error) => (
              <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                {error()}
              </div>
            )}
          </Show>
          <Button type="submit" variant="contrast" data-action="provider-connect-submit">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthCodeView() {
    let codeInput: HTMLInputElement | undefined
    const errorID = createUniqueId()
    const [formStore, setFormStore] = createStore({
      value: "",
      error: undefined as string | undefined,
    })

    onMount(() => {
      codeInput?.focus({ preventScroll: true })
    })

    async function handleSubmit(e: SubmitEvent) {
      e.preventDefault()

      if (!(e.currentTarget instanceof HTMLFormElement)) return
      const value = new FormData(e.currentTarget).get("code")
      const code = typeof value === "string" ? value : ""

      if (!code?.trim()) {
        setFormStore("error", language.t("provider.connect.oauth.code.required"))
        return
      }

      setFormStore("error", undefined)
      setFormStore("error", await controller.auth.completeCode(code))
    }

    return (
      <div class="flex flex-col gap-5 px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <div>{language.t("provider.connect.oauth.code.description", { provider: provider().name })}</div>
        <Button variant="neutral" icon="arrow-up-right" onClick={() => void controller.auth.open()}>
          {language.t("provider.connect.oauth.openBrowser")}
        </Button>
        <form onSubmit={handleSubmit} class="flex flex-col items-start gap-5 self-stretch">
          <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
            {language.t("provider.connect.oauth.code.label", { method: controller.currentMethod()?.label ?? "" })}
            <TextInput
              ref={codeInput}
              class="!w-full"
              name="code"
              placeholder={language.t("provider.connect.oauth.code.placeholder")}
              value={formStore.value}
              invalid={formStore.error !== undefined}
              aria-describedby={formStore.error ? errorID : undefined}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setFormStore("value", event.currentTarget.value)}
            />
          </label>
          <Show when={formStore.error}>
            {(error) => (
              <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                {error()}
              </div>
            )}
          </Show>
          <Button type="submit" variant="contrast">
            {language.t("common.continue")}
          </Button>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    return (
      <div class="flex flex-col gap-5 px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <div>{language.t("provider.connect.oauth.auto.description", { provider: provider().name })}</div>
        <StatusRow>{language.t("provider.connect.status.waiting")}</StatusRow>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="neutral" icon="arrow-up-right" onClick={() => void controller.auth.open()}>
            {language.t("provider.connect.oauth.openBrowser")}
          </Button>
        </div>
        <Show when={code()}>
          {(value) => (
            <TextField
              label={language.t("provider.connect.oauth.auto.confirmationCode")}
              description={language.t("provider.connect.oauth.auto.confirmationCode.description")}
              class="font-mono"
              value={value()}
              readOnly
              copyable
            />
          )}
        </Show>
      </div>
    )
  }

  // Deliberately quiet: most people should never need a key, so this stays small and at the bottom.
  function ConsoleApiKeySwitch() {
    return (
      <div data-component="console-service-account" class="flex h-7 items-center gap-1 px-3 pt-5 text-[13px]">
        <span class="text-v2-text-text-faint">{language.t("provider.connect.console.serviceAccount")}</span>
        <Button
          variant="ghost-muted"
          data-action="provider-connect-api-key"
          onClick={() => void controller.auth.select(keyIndex())}
        >
          {language.t("provider.connect.console.useApiKey")}
        </Button>
      </div>
    )
  }

  function ConsoleNoModels() {
    return (
      <div role="status" class="flex flex-col items-start gap-5 px-3 text-[13px] leading-5 text-v2-text-text-muted">
        <div>
          <p class="flex items-center gap-2 font-medium text-v2-text-text-base">
            <Icon name="circle-check" />
            {language.t("provider.connect.console.connected")}
          </p>
          <p>
            {language.t(
              state.catalogPending ? "provider.connect.console.modelsLoading" : "provider.connect.console.noModels",
            )}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={!state.catalogPending}>
            <Button onClick={() => platform.openExternal("https://opencode.ai/console")}>
              {language.t("provider.connect.console.openAgain")}
            </Button>
          </Show>
          <Button
            disabled={controller.auth.state() === "refreshing"}
            aria-busy={controller.auth.state() === "refreshing"}
            onClick={() => void controller.auth.refresh()}
          >
            {language.t("provider.connect.console.refresh")}
          </Button>
        </div>
      </div>
    )
  }

  const startWithModel = async () => {
    const model = selectedModel()
    if (!model) return
    const selection = { providerID: model.providerID, modelID: model.id }
    if (props.selection) {
      props.selection.set(selection)
      props.onDone?.()
      dialog.close()
      return
    }
    dialog.close()
    await tabs.newDraft(
      {
        server: ServerConnection.key(sdk.server),
        directory: initialDirectory ?? data.location.default().directory,
      },
      undefined,
      selection,
    )
  }

  function ConnectionModelList(listProps: { items: ReturnType<typeof connectionModels> }) {
    return (
      <SettingsList>
        <For each={listProps.items}>
          {(model) => {
            const selected = () => state.selectedModel === modelKey(model)
            return (
              <div data-component="connected-model-row-shell" class="connected-model-row-shell">
                <button
                  type="button"
                  role="radio"
                  data-component="settings-row"
                  data-first-provider-model=""
                  data-selected={selected() ? "" : undefined}
                  aria-checked={selected()}
                  class="connected-model-row text-start focus-visible:outline-none"
                  onClick={() => setState("selectedModel", modelKey(model))}
                >
                  <div data-slot="settings-row-copy">
                    <div data-slot="settings-row-title">
                      <span class="min-w-0 truncate">{model.name}</span>
                    </div>
                  </div>
                  <div data-slot="settings-row-control" class="size-4">
                    <Show when={selected()}>
                      <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-base" />
                    </Show>
                  </div>
                </button>
              </div>
            )
          }}
        </For>
      </SettingsList>
    )
  }

  function FirstConnectionModels() {
    return (
      <div data-component="first-provider-models" class="flex min-h-0 flex-1 flex-col px-3">
        <p class="shrink-0 pb-5 text-[13px] leading-5 text-v2-text-text-muted">
          {language.t("provider.connect.models.description")}
        </p>
        <div
          data-component="first-provider-model-scroll"
          class="settings-panel settings-models min-h-0 flex-1 overflow-y-auto pb-4"
        >
          <div data-component="available-models-heading" class="flex items-center gap-1.5">
            <span class="text-[13px] font-[530] leading-4 text-v2-text-text-base">
              {language.t("provider.connect.models.available")}
            </span>
            <Show when={managedProviders()}>{(managed) => <Badge>{managed().workspace}</Badge>}</Show>
          </div>
          <div role="radiogroup" aria-label={language.t("provider.connect.models.list", { provider: provider().name })}>
            <Show
              when={managedProviders()}
              fallback={
                <Show
                  when={connectionGroups().length > 1}
                  fallback={<ConnectionModelList items={connectionGroups()[0]?.models ?? []} />}
                >
                  <For each={connectionGroups()}>
                    {(group) => {
                      const expanded = () => !state.collapsed[group.provider.id]
                      return (
                        <section class="settings-section" data-expanded={expanded() ? "" : undefined}>
                          <h3 class="settings-models-group-header sticky top-0 z-[1] box-content bg-v2-background-bg-layer-01">
                            <button
                              type="button"
                              class="settings-models-group-trigger"
                              aria-expanded={expanded()}
                              onClick={() => setState("collapsed", group.provider.id, expanded())}
                            >
                              <span class="settings-models-group-chevron">
                                <Icon name="chevron-down" size="small" classList={{ collapsed: !expanded() }} />
                              </span>
                              <span class="settings-models-group-label">
                                <ProviderModelIcon provider={group.provider} class="shrink-0" />
                                <span class="settings-section-title">{group.provider.name}</span>
                              </span>
                            </button>
                          </h3>
                          <Show when={expanded()}>
                            <ConnectionModelList items={group.models} />
                          </Show>
                        </section>
                      )
                    }}
                  </For>
                </Show>
              }
            >
              <div class="provider-model-groups provider-model-groups--dialog">
                <For each={connectionGroups()}>
                  {(group) => (
                    <ProviderModelGroup
                      provider={group.provider}
                      name={connectionGroupName(group.provider.name)}
                      expanded={!state.collapsed[group.provider.id]}
                      onExpandedChange={(value) => setState("collapsed", group.provider.id, !value)}
                    >
                      <ConnectionModelList items={group.models} />
                    </ProviderModelGroup>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
        <div
          data-component="first-provider-model-footer"
          class="-mx-5 flex h-15 shrink-0 items-center justify-end border-t border-v2-border-border-muted px-4"
        >
          <Button variant="contrast" disabled={!selectedModel()} onClick={() => void startWithModel()}>
            {language.t("common.continue")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Show when={!state.models} fallback={<FirstConnectionModels />}>
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          class={isConsole ? "flex shrink-0 items-center gap-2 px-3 pb-6" : "flex h-10 shrink-0 items-start gap-2 px-3"}
        >
          <ProviderModelIcon
            provider={provider()}
            class={isConsole ? "shrink-0 text-v2-icon-icon-base" : "mt-0.5 shrink-0 text-v2-icon-icon-base"}
          />
          <div class="text-[15px] font-[530] leading-5 tracking-[-0.13px] text-v2-text-text-base">
            <DialogTitle>
              <Switch>
                <Match when={consoleSignIn()}>{language.t("provider.connect.console.title")}</Match>
                <Match
                  when={
                    props.provider === "anthropic" && controller.currentMethod()?.label?.toLowerCase().includes("max")
                  }
                >
                  {language.t("provider.connect.title.anthropicProMax")}
                </Match>
                <Match when={true}>{language.t("provider.connect.title", { provider: provider().name })}</Match>
              </Switch>
            </DialogTitle>
          </div>
        </div>
        <div
          data-component="provider-connect-content"
          class={isConsole ? "flex min-h-0 flex-1 flex-col overflow-y-auto pb-4" : "flex min-h-0 flex-1 flex-col"}
        >
          <Show when={remote}>
            <div class="mb-5 px-3">
              <RemoteAuthNotice server={sdk.server} />
            </div>
          </Show>
          <Switch>
            <Match when={state.noModels && controller.auth.state() !== "error"}>
              <ConsoleNoModels />
            </Match>
            <Match when={consoleSignIn()}>
              <div class="px-3">
                <ConsoleAuthorization
                  code={code()}
                  browserFailed={controller.browserFailed()}
                  copied={state.copied}
                  copyFailed={state.copyFailed}
                  onCopy={() => void copyLink()}
                  onOpen={() => void controller.auth.open()}
                />
              </div>
            </Match>
            <Match when={controller.busy()}>
              <div class="px-3">
                <StatusRow>{language.t("provider.connect.status.inProgress")}</StatusRow>
              </div>
            </Match>
            <Match when={controller.methodIndex() === undefined}>
              <MethodSelection />
            </Match>
            <Match when={controller.auth.state() === "form"}>
              <AuthFormView />
            </Match>
            <Match when={controller.auth.state() === "error"}>
              <div class="px-3">
                <ErrorRow />
              </div>
            </Match>
            <Match when={controller.currentMethod()?.type === "key"}>
              <ApiAuthView />
            </Match>
            <Match when={controller.authorization()?.mode === "code"}>
              <OAuthCodeView />
            </Match>
            <Match when={controller.authorization()?.mode === "auto"}>
              <OAuthAutoView />
            </Match>
          </Switch>
          <Show
            when={
              isConsole &&
              !controller.loading() &&
              !state.noModels &&
              controller.currentMethod()?.type !== "key" &&
              keyIndex() !== -1
            }
          >
            <ConsoleApiKeySwitch />
          </Show>
        </div>
      </div>
    </Show>
  )
}
