import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { Checkbox } from "@opencode/ui/checkbox"
import { Loader } from "@opencode/ui/loader"
import { Field } from "@opencode/ui/field"
import { DialogBody, DialogHeader, DialogTitle, DialogTitleGroup, Dialog } from "@opencode/ui/dialog"
import { RedirectPasteForm } from "@opencode/ui/redirect-paste"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { type Component, createMemo, createUniqueId, For, type JSX, Match, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { consoleProviderName } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { ProviderModelGroup, ProviderModelIcon } from "@/providers/models/provider-group"
import type { ModelSelection } from "@/providers/models/selection"
import { decode64 } from "@/runtime/persistence/base64"
import { SettingsList } from "@/settings/list"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { Schema } from "effect"
import type { FormField, IntegrationInfo } from "@opencode/client/promise"
import { createProviderDialogController, modelKey } from "./controller"
import { CONSOLE_INTEGRATION, type ProviderDialogBody, type ProviderDialogFrame } from "./dialog-machine"
import { connectMethods, selectProviderConnectView, type ProviderConnectMethod } from "./machine"
import type { ProviderFormInput, ProviderFormView } from "./form-machine"
import { ConsoleAuthorization } from "./console"
import { StepActions, WaitingButton } from "./step-actions"
import { DialogChatGPTPlanWelcome } from "./chatgpt-welcome"
import { authServerName } from "./remote"
import { providerAccounts } from "@/settings/providers/accounts"
import { AccountNameInput } from "@/settings/providers/account-name"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { writeClipboard } from "@opencode/session-ui/copy"
import { showToast } from "@/shell/notifications/toast"
import "@/shell/search-list.css"
import "./models.css"

export function useProviderConnectController() {
  const [store, setStore] = createStore<{ selected?: string }>({})
  const reset = () => setStore("selected", undefined)

  return {
    selected: () => store.selected,
    select: (provider?: string) => setStore("selected", provider),
    reset,
  }
}

type ProviderDialogController = ReturnType<typeof createProviderDialogController>

// What a step without a sign-in reads, so the sign-in views never branch on a missing one.
const NO_CONNECT = selectProviderConnectView({ status: "disposed" })

// A provider step fits its content; the list and the models keep a fixed height.
const FRAME_HEIGHT = {
  picker: "!h-[min(calc(100vh_-_16px),512px)]",
  models: "!h-[min(calc(100vh_-_8px_-_var(--connect-top)),560px)]",
  accounts: "!h-auto !max-h-[min(calc(100vh_-_8px_-_var(--connect-top)),560px)]",
  provider: "!h-auto !max-h-[min(calc(100vh_-_8px_-_var(--connect-top)),560px)]",
} satisfies Record<ProviderDialogFrame, string>

export const DialogConnectProvider: Component<{
  directory?: string
  /** Connects at the server's default Location instead of the current route's directory. */
  defaultLocation?: boolean
  controller?: ReturnType<typeof useProviderConnectController>
  /** Opened for one provider from another flow, with no way back to the provider list. */
  standalone?: boolean
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: (provider: string) => void
}> = (props) => {
  const fallback = useProviderConnectController()
  const external = props.controller ?? fallback
  const language = useLanguage()
  const dialog = useDialog()
  const params = useParams()

  const [welcome, setWelcome, , welcomeReady] = persisted(
    Persist.global("chatgpt-plan-welcome.v1"),
    Persistence.struct({ seen: Schema.Boolean }),
    { seen: false },
  )

  const controller = createProviderDialogController({
    // A sign-in belongs to the Location where it began, even if the route changes underneath it.
    directory: props.defaultLocation ? undefined : (props.directory ?? decode64(params.dir)),
    standalone: !!props.standalone,
    selected: external.selected,
    onSelect: external.select,
    selection: props.selection,
    onConnected: (provider) => props.onConnected?.(provider),
  })

  const view = controller.view
  const frame = () => view().frame
  const consoleSelected = () => view().provider === CONSOLE_INTEGRATION
  let focusHost: HTMLDivElement | undefined
  const holdFocus = () => focusHost?.focus({ preventScroll: true })

  const providerName = () =>
    consoleSelected() ? language.t("provider.connect.opencode.name") : controller.providerName()

  // A Console sign-in through another server is stored on that server, so the header names it.
  const sdk = useServerSDK()
  const remoteServer = () => (consoleSelected() && frame() !== "picker" ? authServerName(sdk.server) : undefined)

  return (
    <Dialog
      preventBackdropDismiss={view().preventBackdropDismiss}
      // The top edge stays where the provider list puts it, so a step that fits its content only moves the bottom edge.
      containerClass={`!self-start !rounded-[12px] !bg-v2-background-bg-base [--connect-top:max(8px,calc((100vh_-_512px)/2))] !mt-[var(--connect-top)] !w-[min(calc(100vw_-_16px),640px)] ${
        FRAME_HEIGHT[frame()]
      }`}
      onCloseAutoFocus={(event) => {
        if (view().completed && props.selection && props.onDone) {
          event.preventDefault()
          props.onDone()
        }

        if (!view().chatgptWelcome) return
        void Promise.resolve(welcomeReady.promise).then(() => {
          if (welcome.seen) return
          setWelcome("seen", true)
          void dialog.show(() => <DialogChatGPTPlanWelcome />)
        })
      }}
      class="[font-family:var(--v2-font-family-sans)]"
      classList={{
        "[&_[data-slot=dialog-header]]:!px-4 [&_[data-slot=dialog-header]]:!pt-4 [&_[data-slot=dialog-close-button]]:!mt-0 [&_[data-slot=dialog-close-button]]:!-me-0.5": true,
        "[&_[data-slot=dialog-header]]:!pb-2": frame() !== "models",
        "[&_[data-slot=dialog-header-title]]:!text-[15px] [&_[data-slot=dialog-header-title]]:!tracking-[-0.13px]":
          frame() === "models",
        "search-dialog": frame() === "picker" || frame() === "accounts",
        "[&_[data-slot=dialog-description]]:!text-[13px] [&_[data-slot=dialog-description]]:!tracking-[-0.04px]":
          frame() === "picker",
      }}
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <Switch>
          <Match when={frame() === "models" && view().provider}>
            {(provider) => (
              <div class="flex items-center gap-2">
                <ProviderModelIcon provider={{ id: provider(), name: controller.providerName() }} class="shrink-0" />
                <DialogTitle>
                  {language.t("provider.connect.models.title", { provider: controller.providerName() })}
                </DialogTitle>
              </div>
            )}
          </Match>
          <Match when={view().provider}>
            {(provider) => (
              <>
                <nav
                  aria-label={language.t("provider.connect.breadcrumb.label")}
                  class="flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-5 tracking-[-0.04px]"
                >
                  <For each={view().crumbs}>
                    {(crumb, index) => {
                      const last = () => index() === view().crumbs.length - 1
                      const target = () => crumb.target

                      const label = () =>
                        crumb.kind === "root" ? language.t("provider.connect.breadcrumb.root") : providerName()

                      const content = () => (
                        <>
                          <Show when={crumb.kind === "provider"}>
                            <ProviderModelIcon
                              provider={{ id: provider(), name: providerName() }}
                              class="shrink-0 text-v2-icon-icon-base"
                            />
                          </Show>
                          <span class="min-w-0 truncate">{label()}</span>
                        </>
                      )

                      return (
                        <>
                          <Show when={index() > 0}>
                            <Icon name="chevron-right" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                          </Show>
                          <Switch>
                            <Match when={last()}>
                              {/* A sign-in started from the accounts list ends at the provider, which leads back to it. */}
                              <Show
                                when={target()}
                                fallback={
                                  <span class="flex min-w-0 items-center gap-1.5 font-[530] text-v2-text-text-base">
                                    {content()}
                                  </span>
                                }
                              >
                                {(value) => (
                                  <button
                                    type="button"
                                    class="flex min-w-0 items-center gap-1.5 rounded-sm font-[530] text-v2-text-text-base hover:text-v2-text-text-muted focus-visible:text-v2-text-text-muted focus-visible:outline-none"
                                    onClick={() => controller.navigate(value())}
                                  >
                                    {content()}
                                  </button>
                                )}
                              </Show>
                            </Match>
                            <Match when={target()}>
                              {(value) => (
                                <button
                                  type="button"
                                  class="flex min-w-0 shrink items-center gap-1.5 rounded-sm font-[440] text-v2-text-text-faint hover:text-v2-text-text-base focus-visible:text-v2-text-text-base focus-visible:outline-none"
                                  onClick={() => controller.navigate(value())}
                                >
                                  {content()}
                                </button>
                              )}
                            </Match>
                            <Match when={true}>
                              <span class="flex min-w-0 shrink items-center gap-1.5 font-[440] text-v2-text-text-faint">
                                {content()}
                              </span>
                            </Match>
                          </Switch>
                        </>
                      )
                    }}
                  </For>
                </nav>
                {/* The breadcrumb shows where the dialog is; the dialog itself is named for what it does. */}
                <div class="sr-only">
                  <DialogTitle>{language.t("provider.connect.title", { provider: providerName() })}</DialogTitle>
                </div>
              </>
            )}
          </Match>
          <Match when={true}>
            <DialogTitleGroup
              title={language.t("dialog.provider.title")}
              description={language.t("dialog.provider.description")}
            />
          </Match>
        </Switch>
        <Show when={remoteServer()}>
          {(server) => (
            <Tooltip
              value={language.t("provider.connect.remote.description")}
              placement="bottom"
              contentClass="!max-w-64 !whitespace-normal"
              triggerTabIndex={0}
              class="me-3 flex min-w-0 shrink-0 !cursor-default items-center gap-1.5 rounded-sm text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted focus-visible:outline-none focus-visible:text-v2-text-text-base"
            >
              <Icon name="server" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="max-w-40 truncate">{language.t("provider.connect.remote.label", { server: server() })}</span>
            </Tooltip>
          )}
        </Show>
      </DialogHeader>
      <DialogBody
        class={`min-h-0 flex-1 overflow-hidden ${
          frame() === "provider" || frame() === "models"
            ? `px-2 ${frame() === "models" ? "pb-0" : "pb-2"}`
            : "px-2 pb-2"
        }`}
      >
        {/* Outside the scrolling content, so it can reach across the body's padding without scrolling sideways. */}
        <Show when={frame() === "accounts"}>
          <div data-slot="search-dialog-divider" class="!-mx-2" />
        </Show>
        <div ref={focusHost} tabIndex={-1} class="flex min-h-0 flex-1 flex-col outline-none">
          <Show
            keyed
            when={view().provider}
            fallback={<ProviderPicker directory={props.directory} onSelect={controller.select} onPrepare={holdFocus} />}
          >
            {(provider) => <ProviderSteps provider={provider} controller={controller} />}
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

const CLAUDE_CODE_SETUP_URL = "https://code.claude.com/docs/en/setup"

const STEP_CLASS =
  "flex flex-col items-start gap-5 px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted"

const methodLabel = (language: ReturnType<typeof useLanguage>, value: ProviderConnectMethod) =>
  value.type === "key" ? (value.label ?? language.t("provider.connect.method.apiKey")) : value.label

const METHOD_ICON = {
  oauth: "window-cursor",
  key: "keyboard",
  command: "terminal",
  external: "server",
} as const satisfies Record<ProviderConnectMethod["type"], string>

// The TUI's integration groups and order, with connected integrations pulled up into their own group first.
const POPULAR = ["opencode", "opencode-go", "openai", "github-copilot", "anthropic", "google"]

function ProviderPicker(props: { directory?: string; onSelect: (provider: string) => void; onPrepare?: () => void }) {
  const integrations = useIntegrations(() => props.directory)
  const language = useLanguage()

  const [store, setStore] = createStore<{
    filter: string
    active?: string
  }>({
    filter: "",
  })

  // MCP servers are connected and managed from the MCP dialog, not here.
  const all = createMemo(() => {
    const query = store.filter.trim().toLowerCase()

    return integrations
      .list()
      .filter((row) => row.metadata?.source !== "mcp")
      .filter((row) => !query || `${row.id} ${row.name}`.toLowerCase().includes(query))
  })

  const connected = createMemo(() =>
    all()
      .filter((row) => row.connections.length > 0)
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const unconnected = createMemo(() => all().filter((row) => row.connections.length === 0))

  const popular = createMemo(() =>
    unconnected()
      .filter((row) => POPULAR.includes(row.id))
      .toSorted((a, b) => POPULAR.indexOf(a.id) - POPULAR.indexOf(b.id)),
  )

  const services = createMemo(() =>
    unconnected()
      .filter((row) => !POPULAR.includes(row.id))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const groups = () => [
    { title: language.t("dialog.provider.connected"), items: connected },
    { title: language.t("dialog.provider.group.popular"), items: popular },
    { title: language.t("dialog.provider.group.services"), items: services },
  ]

  // An integration that only reads environment variables has nothing to connect from here.
  const disabled = (row: IntegrationInfo) => connectMethods(row).length === 0 && providerAccounts(row).length === 0

  const rows = createMemo(() => [...connected(), ...popular(), ...services()].filter((row) => !disabled(row)))

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
    <div ref={picker} class="flex min-h-0 flex-1 flex-col gap-0.5" onKeyDown={handleKeyDown}>
      <div class="search-dialog-search shrink-0 after:!-mx-2">
        <TextInput
          ref={search}
          type="search"
          class="!h-8 !w-full [font-family:var(--v2-font-family-sans)]"
          leadingIcon={<Icon name="magnifying-glass" />}
          placeholder={language.t("common.search.placeholder")}
          aria-label={language.t("dialog.provider.search.placeholder")}
          value={store.filter}
          onInput={(event) => {
            setStore({ filter: event.currentTarget.value, active: undefined })
          }}
        />
      </div>
      <div class="relative min-h-0 flex-1">
        <div class="flex size-full min-h-0 flex-col gap-0.5 overflow-y-auto pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <For each={groups()}>
            {(group) => (
              <Show when={group.items().length > 0}>
                <section class="flex flex-col gap-0.5">
                  <div class="px-2 pt-2.5 pb-0.5 text-[12px] font-[440] leading-[18px] tracking-[0.05px] text-v2-text-text-faint">
                    {group.title}
                  </div>
                  <For each={group.items()}>
                    {(provider) => {
                      const connection = () => provider.connections[0]

                      // The server lists the active account first.
                      const account = () => {
                        const current = connection()

                        if (!current) return

                        return current.type === "credential" ? current.label : `$${current.name}`
                      }

                      return (
                        <button
                          type="button"
                          data-provider-id={provider.id}
                          class="flex min-h-8 w-full items-center gap-2 rounded-md py-1.5 ps-2 pe-2 text-left text-[13px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus:bg-v2-overlay-simple-overlay-hover focus:outline-none disabled:pointer-events-none"
                          classList={{ "bg-v2-overlay-simple-overlay-hover": store.active === provider.id }}
                          onMouseEnter={() => setStore("active", provider.id)}
                          disabled={disabled(provider)}
                          onClick={() => connect(provider.id)}
                        >
                          <ProviderModelIcon
                            provider={provider}
                            class={`shrink-0 text-v2-icon-icon-base ${disabled(provider) ? "opacity-50" : ""}`}
                          />
                          <span
                            class="min-w-0 truncate font-[440]"
                            classList={{
                              "text-v2-text-text-base": !disabled(provider),
                              "text-v2-text-text-faint": disabled(provider),
                            }}
                          >
                            {provider.name}
                          </span>
                          <Show when={disabled(provider)}>
                            <span class="min-w-0 truncate font-[440] text-v2-text-text-faint">
                              {language.t("dialog.provider.environmentOnly")}
                            </span>
                          </Show>
                          <Show when={account()}>
                            {(label) => (
                              <Badge data-slot="provider-connected" class="min-w-0 shrink truncate">
                                {label()}
                              </Badge>
                            )}
                          </Show>
                          <Show when={!!connection()?.status}>
                            <span
                              data-slot="provider-status"
                              class="ms-auto shrink-0 font-[440] text-[var(--v2-state-fg-warning)]"
                            >
                              {language.t("dialog.provider.needsSignIn")}
                            </span>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </section>
              </Show>
            )}
          </For>
          <Show when={all().length === 0}>
            <div class="flex h-24 items-center justify-center text-[13px] font-[440] text-v2-text-text-muted">
              {language.t("dialog.provider.empty")}
            </div>
          </Show>
        </div>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{ background: "linear-gradient(to bottom, transparent, var(--v2-background-bg-base))" }}
        />
      </div>
    </div>
  )
}

function ProviderSteps(props: { provider: string; controller: ProviderDialogController }) {
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useServerSDK()
  const isConsole = props.provider === CONSOLE_INTEGRATION
  const onRemote = authServerName(sdk.server) !== undefined
  const view = props.controller.view
  const connect = () => view().connect ?? NO_CONNECT
  const body = createMemo(() => view().body)

  const copyText = async (text: string) => {
    const written = await (
      platform.writeClipboardText ? platform.writeClipboardText(text).then(() => true) : writeClipboard(text)
    ).catch(() => false)

    if (written)
      return showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: text,
      })
    showToast({ variant: "error", title: language.t("provider.connect.copyFailed") })
  }

  const name = props.controller.providerName

  const code = createMemo(() => {
    const authorization = connect().authorization

    if (!authorization) return
    const userCode = new URL(authorization.url).searchParams.get("user_code")

    if (userCode) return userCode
    // Device sign-ins put the code after a colon ("Enter code: ABCD-1234"); other instructions are not a code.
    const instructions = authorization.instructions

    if (instructions?.includes(":")) return instructions.split(":").pop()?.trim()
  })

  // Asks one visible field at a time, like the TUI, so `when` conditions see every earlier answer.
  function AuthFormView() {
    const form = () => connect().form
    const send = (event: ProviderFormInput) => props.controller.input({ type: "form", event })

    const external = createMemo(() => {
      const current = form()

      return current?.kind === "external" ? current : undefined
    })

    const multiselect = createMemo(() => {
      const current = form()

      return current?.kind === "multiselect" ? current : undefined
    })

    const choice = createMemo(() => {
      const current = form()

      return current?.kind === "choice" ? current : undefined
    })

    const text = createMemo(() => {
      const current = form()

      return current?.kind === "text" ? current : undefined
    })

    const error = () => {
      const current = form()
      const value = current?.kind === "choice" || current?.kind === "text" ? current.error : undefined

      if (value === "required") return language.t("provider.connect.form.required")

      if (value === "number") return language.t("provider.connect.form.number")
    }

    function FormError() {
      return (
        <Show when={error()}>
          {(message) => (
            <div role="alert" class="text-xs text-v2-state-fg-danger">
              {message()}
            </div>
          )}
        </Show>
      )
    }

    const issue = (value: Extract<ProviderFormView, { kind: "multiselect" }>) => {
      if (value.issue === "select-one") return language.t("provider.connect.form.selectOne")

      if (value.issue === "min-items")
        return language.t("provider.connect.form.minItems", { count: value.field.minItems ?? 0 })

      if (value.issue === "max-items")
        return language.t("provider.connect.form.maxItems", { count: value.field.maxItems ?? 0 })
    }

    const optionRows = (field: Extract<FormField, { type: "boolean" | "string" | "multiselect" }>) => {
      if (field.type === "boolean") {
        const rows = [
          { value: "true", label: language.t("provider.connect.form.yes"), description: undefined },
          { value: "false", label: language.t("provider.connect.form.no"), description: undefined },
        ]

        return field.default === false ? rows.toReversed() : rows
      }

      return (field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      }))
    }

    return (
      // Keyed by step, so each step mounts fresh inputs that take focus.
      <Show when={form()?.key} keyed>
        <div data-component="provider-connect-form" class="flex flex-col items-start gap-2 px-2 pt-2">
          <Show when={!text()}>
            <div class="flex w-full flex-col gap-1">
              <div class="text-[13px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base">
                {form()?.title}
              </div>
              <Show when={form()?.description}>
                {(description) => (
                  <div class="text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
                    {description()}
                  </div>
                )}
              </Show>
            </div>
          </Show>
          <Switch>
            <Match when={external()}>
              {(step) => (
                <div class="flex w-full flex-col gap-5 pt-3">
                  <Show when={step().browserFailed}>
                    <div class="flex w-full flex-col gap-2">
                      <div role="alert" class="text-xs text-v2-state-fg-danger">
                        {language.t("provider.connect.form.browserFailed")}
                      </div>
                      <TextInput
                        class="!w-full"
                        appearance="large"
                        aria-label={step().title}
                        value={step().url}
                        readOnly
                        showCopyButton
                        onCopyClick={() => void copyText(step().url)}
                        spellcheck={false}
                        classList={{ "[&_input]:font-mono": true }}
                      />
                    </div>
                  </Show>
                  <StepActions>
                    <Button
                      variant="ghost"
                      disabled={step().opening}
                      aria-busy={step().opening}
                      onClick={() => send({ type: "external.open" })}
                    >
                      {language.t("provider.connect.form.open")}
                    </Button>
                    <Button
                      variant="submit"
                      disabled={!step().canFinish}
                      onClick={() => send({ type: "step.submitted" })}
                    >
                      {language.t("provider.connect.form.finished")}
                    </Button>
                  </StepActions>
                </div>
              )}
            </Match>
            <Match when={multiselect()}>
              {(step) => {
                const options = () => optionRows(step().field)

                return (
                  <div class="flex w-full flex-col gap-5">
                    <div class="flex flex-col gap-2">
                      <For
                        each={[
                          ...options(),
                          ...step()
                            .picked.filter((item) => !options().some((option) => option.value === item))
                            .map((value) => ({ value, label: value, description: undefined })),
                        ]}
                      >
                        {(option) => (
                          <Checkbox
                            checked={step().picked.includes(option.value)}
                            description={option.description}
                            onChange={(checked: boolean) =>
                              send({ type: "option.toggled", value: option.value, checked })
                            }
                          >
                            {option.label}
                          </Checkbox>
                        )}
                      </For>
                    </div>
                    <Show when={step().field.custom}>
                      <form
                        class="flex w-full items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          send({ type: "custom.item.added" })
                        }}
                      >
                        <TextInput
                          class="min-w-0 flex-1"
                          appearance="large"
                          placeholder={language.t("ui.question.custom.placeholder")}
                          aria-label={language.t("ui.messagePart.option.typeOwnAnswer")}
                          value={step().customText}
                          onInput={(event) => send({ type: "custom.text.changed", value: event.currentTarget.value })}
                        />
                        <Button type="submit" variant="neutral" size="large">
                          {language.t("provider.connect.form.add")}
                        </Button>
                      </form>
                    </Show>
                    <Show when={issue(step())}>
                      {(message) => <div class="text-xs text-v2-text-text-muted">{message()}</div>}
                    </Show>
                    <StepActions>
                      <Button
                        variant="submit"
                        disabled={!step().canContinue}
                        onClick={() => send({ type: "step.submitted" })}
                      >
                        {language.t("common.continue")}
                      </Button>
                    </StepActions>
                  </div>
                )
              }}
            </Match>
            <Match when={choice()}>
              {(step) => (
                <div class="flex w-full flex-col gap-5">
                  <RadioGroup
                    label={step().title}
                    hideLabel
                    value={step().selected}
                    onChange={(value) => send({ type: "choice.selected", value })}
                  >
                    <For each={optionRows(step().field)}>
                      {(option) => (
                        <RadioItem value={option.value} label={option.label} description={option.description} />
                      )}
                    </For>
                    <Show when={step().custom}>
                      <RadioItem value="custom" label={language.t("ui.messagePart.option.typeOwnAnswer")} />
                      <Show when={step().selected === "custom"}>
                        <div class="pl-6">
                          <TextInput
                            ref={(input: HTMLInputElement) => queueMicrotask(() => input.focus())}
                            class="!w-full"
                            appearance="large"
                            aria-label={language.t("ui.messagePart.option.typeOwnAnswer")}
                            placeholder={step().placeholder ?? language.t("ui.question.custom.placeholder")}
                            value={step().customText}
                            onInput={(event) => send({ type: "custom.text.changed", value: event.currentTarget.value })}
                          />
                        </div>
                      </Show>
                    </Show>
                  </RadioGroup>
                  <FormError />
                  <StepActions>
                    <Show when={step().canSkip}>
                      <Button variant="ghost" onClick={() => send({ type: "step.skipped" })}>
                        {language.t("provider.connect.form.skip")}
                      </Button>
                    </Show>
                    <Button
                      variant="submit"
                      disabled={!step().canContinue}
                      onClick={() => send({ type: "step.submitted" })}
                    >
                      {language.t("common.continue")}
                    </Button>
                  </StepActions>
                </div>
              )}
            </Match>
            <Match when={text()}>
              {(step) => (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    send({ type: "step.submitted" })
                  }}
                  class="flex w-full flex-col items-start gap-5"
                >
                  <Field invalid={step().error !== undefined}>
                    <Field.Label>{step().title}</Field.Label>
                    <Show when={step().description}>
                      {(description) => (
                        <Field.Prefix class="!-mt-1 !text-[13px] !leading-5 !tracking-[-0.04px]">
                          {description()}
                        </Field.Prefix>
                      )}
                    </Show>
                    <TextInput
                      ref={(input: HTMLInputElement) => queueMicrotask(() => input.focus({ preventScroll: true }))}
                      class="!w-full"
                      appearance="large"
                      type="text"
                      inputMode={step().numeric ? "decimal" : undefined}
                      placeholder={step().placeholder}
                      value={step().text}
                      invalid={step().error !== undefined}
                      autocomplete="off"
                      spellcheck={false}
                      onInput={(event) => send({ type: "text.changed", value: event.currentTarget.value })}
                    />
                    <FormError />
                  </Field>
                  <StepActions>
                    <Button type="submit" variant="submit">
                      {language.t("common.continue")}
                    </Button>
                  </StepActions>
                </form>
              )}
            </Match>
          </Switch>
        </div>
      </Show>
    )
  }

  function MethodSelection() {
    return (
      <div class="flex flex-col">
        <p class="px-2 pb-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          {language.t("provider.connect.methods.description", { provider: name() })}
        </p>
        <For each={connect().methods}>
          {(item, index) => (
            <button
              type="button"
              data-action="provider-connect-method"
              class="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
              onClick={() => props.controller.input({ type: "method.selected", index: index() })}
            >
              <Icon name={METHOD_ICON[item.type]} size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-base">
                {methodLabel(language, item)}
              </span>
              <Icon
                name="chevron-right"
                size="small"
                class="shrink-0 text-v2-icon-icon-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </button>
          )}
        </For>
      </div>
    )
  }

  function CommandView() {
    return (
      <div class={STEP_CLASS}>
        <Show when={connect().commandOutput.trim()}>
          {(output) => (
            <pre
              data-component="provider-connect-command-output"
              class="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-v2-background-bg-layer-03 px-3 py-2 font-mono text-[12px] leading-[18px] text-v2-text-text-base"
            >
              {output()}
            </pre>
          )}
        </Show>
        <StepActions>
          <WaitingButton>{language.t("provider.connect.command.waiting")}</WaitingButton>
        </StepActions>
      </div>
    )
  }

  function StatusRow(input: { children: JSX.Element }) {
    return (
      <div class="flex items-center gap-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
        <span>{input.children}</span>
      </div>
    )
  }

  function ErrorLine(input: { children: JSX.Element }) {
    return (
      <div class="flex items-start gap-2 text-v2-text-text-base">
        <Icon name="circle-ban-sign" size="small" class="mt-0.5 shrink-0 text-v2-state-fg-danger" />
        <span role="alert">{input.children}</span>
      </div>
    )
  }

  function ErrorRow() {
    return (
      <div class={STEP_CLASS}>
        <ErrorLine>
          {isConsole ? connect().error : language.t("provider.connect.status.failed", { error: connect().error ?? "" })}
        </ErrorLine>
        <StepActions>
          <Button variant="submit" onClick={() => props.controller.input({ type: "retry" })}>
            {language.t(isConsole ? "provider.connect.console.retry" : "common.retry")}
          </Button>
        </StepActions>
      </div>
    )
  }

  const entryError = () => {
    const error = connect().entryError

    if (error?.type === "rejected") return error.message

    if (!error) return

    return language.t(
      connect().screen === "code" ? "provider.connect.oauth.code.required" : "provider.connect.apiKey.required",
    )
  }

  const submitEntry = (event: SubmitEvent, name: string) => {
    event.preventDefault()

    if (!(event.currentTarget instanceof HTMLFormElement)) return
    const value = new FormData(event.currentTarget).get(name)
    props.controller.input({ type: "entry.submitted", value: value instanceof File || value === null ? "" : value })
  }

  function EntryField(input: {
    name: string
    label: string
    placeholder: string
    ref: (el: HTMLInputElement) => void
  }) {
    const errorID = createUniqueId()

    return (
      <div class="flex w-full flex-col gap-2">
        <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
          {input.label}
          <TextInput
            ref={input.ref}
            class="!w-full"
            appearance="large"
            name={input.name}
            data-input={input.name === "apiKey" ? "provider-api-key" : undefined}
            placeholder={input.placeholder}
            readOnly={connect().submitting}
            invalid={entryError() !== undefined}
            aria-describedby={entryError() ? errorID : undefined}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        <Show when={entryError()}>
          {(error) => (
            <div id={errorID} role="alert" class="text-xs text-v2-state-fg-danger">
              {error()}
            </div>
          )}
        </Show>
      </div>
    )
  }

  function ApiAuthView() {
    let apiKey: HTMLInputElement | undefined

    onMount(() => {
      apiKey?.focus({ preventScroll: true })
    })

    return (
      <form onSubmit={(event) => submitEntry(event, "apiKey")} class={STEP_CLASS}>
        <p>
          {isConsole
            ? language.t("provider.connect.console.serviceKeyDescription")
            : language.t("provider.connect.apiKey.description", { provider: name() })}
        </p>
        <EntryField
          name="apiKey"
          label={language.t("provider.connect.apiKey.label", { provider: name() })}
          placeholder={language.t("provider.connect.apiKey.placeholder")}
          ref={(el) => (apiKey = el)}
        />
        <StepActions>
          <Button
            type="submit"
            variant="submit"
            data-action="provider-connect-submit"
            disabled={connect().submitting}
            aria-busy={connect().submitting}
          >
            {language.t("common.continue")}
          </Button>
        </StepActions>
      </form>
    )
  }

  function OAuthCodeView() {
    let codeInput: HTMLInputElement | undefined

    onMount(() => {
      codeInput?.focus({ preventScroll: true })
    })

    return (
      <form onSubmit={(event) => submitEntry(event, "code")} class={STEP_CLASS}>
        <p>{language.t("provider.connect.oauth.code.description", { provider: name() })}</p>
        <EntryField
          name="code"
          label={language.t("provider.connect.oauth.code.label", { method: connect().method?.label ?? "" })}
          placeholder={language.t("provider.connect.oauth.code.placeholder")}
          ref={(el) => (codeInput = el)}
        />
        <StepActions>
          <Button variant="ghost" onClick={() => props.controller.input({ type: "browser.open" })}>
            {language.t("provider.connect.oauth.openBrowser")}
          </Button>
          <Button type="submit" variant="submit" disabled={connect().submitting} aria-busy={connect().submitting}>
            {language.t("common.continue")}
          </Button>
        </StepActions>
      </form>
    )
  }

  function OAuthAutoView() {
    const pasteOpen = () => connect().paste?.open ?? onRemote
    // Stays up while the URL is being sent; once the server takes it, the sign-in is back to waiting.
    const pasteSendable = () => !connect().paste?.locked || connect().paste?.submitting

    return (
      <div class={STEP_CLASS}>
        <p>{language.t("provider.connect.oauth.auto.description", { provider: name() })}</p>
        <Show when={code()}>
          {(value) => (
            <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
              {language.t("provider.connect.oauth.auto.confirmationCode")}
              <TextInput
                class="!w-full"
                appearance="large"
                value={value()}
                readOnly
                showCopyButton
                onCopyClick={() => void copyText(value())}
                spellcheck={false}
                classList={{ "[&_input]:font-mono": true }}
              />
            </label>
          )}
        </Show>
        <Show when={connect().browserFailed}>
          <ErrorLine>{language.t("provider.connect.oauth.browserFailed")}</ErrorLine>
        </Show>
        <Show when={connect().paste}>
          {(paste) => (
            <div class="flex flex-col self-stretch border-y border-v2-border-border-muted">
              <button
                type="button"
                aria-expanded={pasteOpen()}
                class="flex h-12 items-center gap-1.5 text-start font-[440] text-v2-text-text-base focus-visible:outline-none focus-visible:underline"
                onClick={() => props.controller.input({ type: "paste.toggled", open: !pasteOpen() })}
              >
                <Icon
                  name="chevron-right"
                  size="small"
                  class="shrink-0 text-v2-icon-icon-muted transition-transform"
                  classList={{ "rotate-90": pasteOpen() }}
                />
                {language.t("provider.connect.oauth.paste.toggle")}
              </button>
              <Show when={pasteOpen()}>
                <div class="flex flex-col gap-4 pb-5">
                  <p class="-mt-2">{language.t("provider.connect.oauth.paste.description")}</p>
                  <RedirectPasteForm
                    hideSubmit
                    value={paste().value}
                    error={paste().error}
                    locked={paste().locked}
                    submitting={paste().submitting}
                    autofocus={paste().open === true}
                    onInput={(value) => props.controller.input({ type: "paste.changed", value })}
                    onSubmit={() => props.controller.input({ type: "paste.submitted" })}
                  />
                </div>
              </Show>
            </div>
          )}
        </Show>
        <StepActions>
          <Button variant="ghost" onClick={() => props.controller.input({ type: "browser.open" })}>
            {language.t("provider.connect.oauth.openBrowser")}
          </Button>
          <Show
            when={pasteOpen() && connect().paste?.value.trim() && pasteSendable()}
            fallback={<WaitingButton>{language.t("provider.connect.status.waiting")}</WaitingButton>}
          >
            <Button
              variant="submit"
              disabled={connect().paste?.locked}
              aria-busy={connect().paste?.submitting}
              onClick={() => props.controller.input({ type: "paste.submitted" })}
            >
              {language.t("common.continue")}
            </Button>
          </Show>
        </StepActions>
      </div>
    )
  }

  function AccountsView(input: { body: Extract<ProviderDialogBody, { kind: "accounts" }> }) {
    const action = () => input.body.action

    const marked = (type: "confirming" | "renaming", id: string) => {
      const current = action()

      return current.type === type && current.accountID === id
    }

    return (
      <div data-component="provider-accounts" class="flex flex-col gap-0.5">
        <div
          role="radiogroup"
          aria-label={language.t("dialog.provider.accounts.connected")}
          class="flex flex-col gap-0.5"
        >
          <For each={props.controller.accounts()}>
            {(account) => (
              <Show
                when={!marked("confirming", account.id)}
                fallback={
                  <div class="flex min-h-8 items-center gap-1.5 rounded-md ps-[30px] pe-1 text-[13px] leading-5 tracking-[-0.04px]">
                    <span role="alert" class="min-w-0 flex-1 truncate font-[440] text-v2-text-text-base">
                      {language.t("dialog.provider.accounts.removeConfirm", { account: account.label })}
                    </span>
                    <Button
                      variant="ghost-muted"
                      onClick={() => props.controller.dispatch({ type: "account.remove.cancelled" })}
                    >
                      {language.t("common.cancel")}
                    </Button>
                    <Button
                      variant="neutral"
                      onClick={() =>
                        props.controller.dispatch({ type: "account.remove.confirmed", accountID: account.id })
                      }
                    >
                      {language.t("dialog.provider.accounts.remove")}
                    </Button>
                  </div>
                }
              >
                <div class="group relative flex min-h-8 items-center rounded-md hover:bg-v2-overlay-simple-overlay-hover focus-within:bg-v2-overlay-simple-overlay-hover has-[[data-expanded]]:bg-v2-overlay-simple-overlay-hover">
                  <Show
                    when={!marked("renaming", account.id)}
                    fallback={
                      <div class="flex min-h-8 min-w-0 flex-1 items-center ps-[30px] pe-2">
                        <AccountNameInput
                          value={account.label}
                          class="-ms-1 max-w-full text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base"
                          onSave={(label) => props.controller.rename(account, label)}
                          onClose={() => props.controller.dispatch({ type: "account.rename.closed" })}
                        />
                      </div>
                    }
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={input.body.activeID === account.id}
                      class="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 ps-2 pe-2 text-start text-[13px] leading-5 tracking-[-0.04px] focus-visible:outline-none"
                      disabled={input.body.busy}
                      onClick={() => props.controller.chooseAccount(account)}
                    >
                      <span class="flex size-4 shrink-0 items-center justify-center">
                        <Show when={input.body.activeID === account.id}>
                          <Icon name="check" size="small" class="text-v2-icon-icon-base" />
                        </Show>
                      </span>
                      <span class="min-w-0 truncate font-[440] text-v2-text-text-base">{account.label}</span>
                      <Show when={account.status}>
                        {(status) => (
                          <span
                            data-slot="provider-account-status"
                            title={status().message}
                            class="ms-auto shrink-0 font-[440] text-[var(--v2-state-fg-warning)]"
                          >
                            {language.t("dialog.provider.needsSignIn")}
                          </span>
                        )}
                      </Show>
                    </button>
                  </Show>
                  <div class="hover-reveal flex shrink-0 items-center pe-1 group-hover:opacity-100 focus-within:opacity-100 has-[[data-expanded]]:opacity-100">
                    <Menu gutter={4} modal={false} placement="bottom-end">
                      <Menu.Trigger
                        as={IconButton}
                        variant="ghost-muted"
                        size="small"
                        icon={<Icon name="outline-dots" />}
                        disabled={input.body.busy}
                        aria-label={language.t("dialog.provider.accounts.options", { account: account.label })}
                      />
                      {/* The modal dialog aria-hides anything added outside it, this portal included, a frame
                            after it opens. Kobalte leaves a node marked as a top layer visible. */}
                      <Menu.Portal
                        ref={(el) => {
                          el.dataset.reactAriaTopLayer = "true"
                        }}
                      >
                        <Menu.Content
                          onCloseAutoFocus={(event) => action().type === "renaming" && event.preventDefault()}
                        >
                          <Menu.Item
                            onSelect={() =>
                              props.controller.dispatch({ type: "account.rename.started", accountID: account.id })
                            }
                          >
                            {language.t("common.rename")}
                          </Menu.Item>
                          <Menu.Item
                            onSelect={() =>
                              props.controller.dispatch({ type: "account.remove.prompted", accountID: account.id })
                            }
                          >
                            {language.t("dialog.provider.accounts.remove")}
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Portal>
                    </Menu>
                  </div>
                </div>
              </Show>
            )}
          </For>
        </div>
        <button
          type="button"
          data-action="provider-account-add"
          class="flex h-8 w-full items-center gap-1.5 rounded-md ps-2 pe-2 text-start text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none disabled:pointer-events-none"
          disabled={!input.body.canAdd}
          onClick={() => props.controller.dispatch({ type: "account.add" })}
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <Icon name="plus" class="text-v2-icon-icon-muted" />
          </span>
          {language.t("dialog.provider.accounts.add")}
        </button>
      </div>
    )
  }

  function ClaudeAgentSetup(input: { body: Extract<ProviderDialogBody, { kind: "claude" }> }) {
    const problem = () =>
      props.controller.claudeProblem()?.message ??
      (input.body.timedOut ? language.t("provider.connect.claudeAgent.timeout") : undefined)

    return (
      <div data-component="claude-agent-setup" class={STEP_CLASS}>
        <p>{language.t("provider.connect.claudeAgent.description")}</p>
        <Show when={problem()}>{(message) => <ErrorLine>{message()}</ErrorLine>}</Show>
        <TextInput
          class="!w-full"
          appearance="large"
          aria-label={language.t("provider.connect.claudeAgent.signIn.command")}
          value="claude auth login"
          readOnly
          showCopyButton
          onCopyClick={() => void copyText("claude auth login")}
          spellcheck={false}
          classList={{ "[&_input]:font-mono": true }}
        />
        <StepActions>
          <Button
            variant="ghost"
            onClick={() => platform.openExternal(props.controller.claudeProblem()?.url ?? CLAUDE_CODE_SETUP_URL)}
          >
            {language.t("provider.connect.claudeAgent.install")}
          </Button>
          <Show
            when={!input.body.checking}
            fallback={<WaitingButton>{language.t("provider.connect.claudeAgent.checking")}</WaitingButton>}
          >
            <Button
              variant="submit"
              data-action="provider-connect-submit"
              disabled={!input.body.canCheck}
              onClick={props.controller.checkClaude}
            >
              {language.t(
                props.controller.accounts().length > 0
                  ? "provider.connect.claudeAgent.checkAgain"
                  : "provider.connect.claudeAgent.connect",
              )}
            </Button>
          </Show>
        </StepActions>
      </div>
    )
  }

  function ConsoleNoModels(input: { body: Extract<ProviderDialogBody, { kind: "no-models" }> }) {
    return (
      <div role="status" class={STEP_CLASS}>
        <div>
          <p class="flex items-center gap-2 font-medium text-v2-text-text-base">
            <Icon name="circle-check" />
            {language.t("provider.connect.console.connected")}
          </p>
          <p>
            {language.t(
              input.body.catalogPending
                ? "provider.connect.console.modelsLoading"
                : "provider.connect.console.noModels",
            )}
          </p>
        </div>
        <StepActions>
          <Show when={!input.body.catalogPending}>
            <Button variant="ghost" onClick={() => platform.openExternal("https://opencode.ai/console")}>
              {language.t("provider.connect.console.openAgain")}
            </Button>
          </Show>
          <Button
            variant="submit"
            disabled={input.body.refreshing}
            aria-busy={input.body.refreshing}
            onClick={() => props.controller.input({ type: "refresh" })}
          >
            {language.t("provider.connect.console.refresh")}
          </Button>
        </StepActions>
      </div>
    )
  }

  function FirstConnectionModels(input: { body: Extract<ProviderDialogBody, { kind: "models" }> }) {
    const managed = props.controller.managedProviders
    const groups = props.controller.connectionGroups

    const selected = () =>
      props.controller.connectionModels().find((model) => modelKey(model) === input.body.selectedModel)

    const collapse = (providerID: string, collapsed: boolean) =>
      props.controller.dispatch({ type: "group.collapsed", providerID, collapsed })

    const confirm = () => {
      const model = selected()

      if (model)
        props.controller.dispatch({
          type: "model.confirmed",
          selection: { providerID: model.providerID, modelID: model.id },
        })
    }

    function ConnectionModelList(listProps: { items: ReturnType<ProviderDialogController["connectionModels"]> }) {
      return (
        <SettingsList>
          <For each={listProps.items}>
            {(model) => {
              const checked = () => input.body.selectedModel === modelKey(model)

              return (
                <div data-component="connected-model-row-shell" class="connected-model-row-shell">
                  <button
                    type="button"
                    role="radio"
                    data-component="settings-row"
                    data-first-provider-model=""
                    data-selected={checked() ? "" : undefined}
                    aria-checked={checked()}
                    class="connected-model-row text-start focus-visible:outline-none"
                    onClick={() => props.controller.dispatch({ type: "model.selected", modelKey: modelKey(model) })}
                  >
                    <div data-slot="settings-row-copy">
                      <div data-slot="settings-row-title">
                        <span class="min-w-0 truncate">{model.name}</span>
                      </div>
                    </div>
                    <div data-slot="settings-row-control" class="size-4">
                      <Show when={checked()}>
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

    return (
      <div data-component="first-provider-models" class="flex min-h-0 flex-1 flex-col px-2">
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
            <Show when={managed()}>{(group) => <Badge>{group().workspace}</Badge>}</Show>
          </div>
          <div role="radiogroup" aria-label={language.t("provider.connect.models.list", { provider: name() })}>
            <Show
              when={managed()}
              fallback={
                <Show when={groups().length > 1} fallback={<ConnectionModelList items={groups()[0]?.models ?? []} />}>
                  <For each={groups()}>
                    {(group) => {
                      const expanded = () => !input.body.collapsed[group.provider.id]

                      return (
                        <section class="settings-section" data-expanded={expanded() ? "" : undefined}>
                          <h3 class="settings-models-group-header sticky top-0 z-[1] box-content bg-v2-background-bg-base">
                            <button
                              type="button"
                              class="settings-models-group-trigger"
                              aria-expanded={expanded()}
                              onClick={() => collapse(group.provider.id, expanded())}
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
              {(group) => (
                <div class="provider-model-groups provider-model-groups--dialog">
                  <For each={groups()}>
                    {(item) => (
                      <ProviderModelGroup
                        provider={item.provider}
                        name={consoleProviderName(group(), item.provider.name)}
                        expanded={!input.body.collapsed[item.provider.id]}
                        onExpandedChange={(value) => collapse(item.provider.id, !value)}
                      >
                        <ConnectionModelList items={item.models} />
                      </ProviderModelGroup>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>
        </div>
        <div
          data-component="first-provider-model-footer"
          class="-mx-4 flex h-15 shrink-0 items-center justify-end border-t border-v2-border-border-muted px-4"
        >
          <Button variant="contrast" disabled={!selected()} onClick={confirm}>
            {language.t("common.continue")}
          </Button>
        </div>
      </div>
    )
  }

  const kind = (value: ProviderDialogBody["kind"]) => body().kind === value

  function narrow<K extends ProviderDialogBody["kind"]>(value: K) {
    const current = body()
    const matches = (item: ProviderDialogBody): item is Extract<ProviderDialogBody, { kind: K }> => item.kind === value

    return matches(current) ? current : undefined
  }

  function StepContent() {
    return (
      <div
        data-component="provider-connect-content"
        data-scrollable
        class="flex min-h-0 flex-1 flex-col overflow-y-auto"
        classList={{ "pb-2": view().frame === "provider" && !kind("methods") }}
      >
        <Switch>
          <Match when={narrow("no-models")}>{(current) => <ConsoleNoModels body={current()} />}</Match>
          <Match when={narrow("console-sign-in")}>
            {(current) => (
              <div class="px-2">
                <ConsoleAuthorization
                  code={code()}
                  browserFailed={connect().browserFailed}
                  copied={current().copy === "copied"}
                  copyFailed={current().copy === "failed"}
                  onCopy={() => void props.controller.copyLink()}
                />
              </div>
            )}
          </Match>
          <Match when={narrow("claude")}>{(current) => <ClaudeAgentSetup body={current()} />}</Match>
          <Match when={narrow("accounts")}>{(current) => <AccountsView body={current()} />}</Match>
          <Match when={kind("busy")}>
            <div class="px-2">
              <StatusRow>{language.t("provider.connect.status.inProgress")}</StatusRow>
            </div>
          </Match>
          <Match when={kind("environment-only")}>
            <div class="px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
              {language.t("dialog.provider.environmentOnly")}
            </div>
          </Match>
          <Match when={kind("methods")}>
            <MethodSelection />
          </Match>
          <Match when={kind("form")}>
            <AuthFormView />
          </Match>
          <Match when={kind("failed")}>
            <ErrorRow />
          </Match>
          <Match when={kind("command")}>
            <CommandView />
          </Match>
          <Match when={kind("key")}>
            <ApiAuthView />
          </Match>
          <Match when={kind("code")}>
            <OAuthCodeView />
          </Match>
          <Match when={kind("browser")}>
            <OAuthAutoView />
          </Match>
        </Switch>
      </div>
    )
  }

  return (
    <Show when={narrow("models")} fallback={<StepContent />}>
      {(models) => <FirstConnectionModels body={models()} />}
    </Show>
  )
}
