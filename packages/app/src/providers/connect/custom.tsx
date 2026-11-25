import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { TextInput } from "@opencode/ui/text-input"
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { modelKey } from "./controller"
import {
  CUSTOM_PROVIDER_PACKAGES,
  CUSTOM_SUBMIT_IDLE,
  customProviderID,
  selectCustomSubmitView,
  transitionCustomSubmit,
  validateCustomProvider,
  type CustomProviderError,
  type CustomProviderFields,
  type CustomProviderPackage,
  type CustomSubmitEffect,
  type CustomSubmitEvent,
} from "./custom-machine"
import { StepActions } from "./step-actions"

const PACKAGE_LABEL = {
  "@opencode/ai/providers/openai-compatible": "provider.custom.protocol.openai",
  "@opencode/ai/providers/anthropic-compatible": "provider.custom.protocol.anthropic",
} as const satisfies Record<CustomProviderPackage, string>

const ERROR_LABEL = {
  required: "provider.custom.error.required",
  "id.invalid": "provider.custom.error.idInvalid",
  "id.taken": "provider.custom.error.idTaken",
  "url.invalid": "provider.custom.error.urlInvalid",
  "models.required": "provider.custom.error.modelsRequired",
  "model.duplicate": "provider.custom.error.modelDuplicate",
  "header.incomplete": "provider.custom.error.headerIncomplete",
} as const satisfies Record<CustomProviderError, string>

const LABEL_CLASS = "flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base"

export function CustomProviderForm(props: {
  location: { directory: string } | undefined
  /** IDs of providers and integrations that already exist. */
  taken: () => ReadonlySet<string>
  onCreated: (providerID: string, firstModel: string | undefined) => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  let rows = 0
  const row = () => `${++rows}`

  const [store, setStore] = createStore<CustomProviderFields & { errors: Record<string, CustomProviderError> }>({
    name: "",
    id: "",
    idEdited: false,
    package: CUSTOM_PROVIDER_PACKAGES[0],
    baseURL: "",
    apiKey: "",
    models: [{ key: row(), id: "", name: "" }],
    headers: [],
    errors: {},
  })
  const [submit, setSubmit] = createSignal(CUSTOM_SUBMIT_IDLE)
  const view = createMemo(() => selectCustomSubmitView(submit()))
  let timer: ReturnType<typeof setTimeout> | undefined
  let form: HTMLFormElement | undefined
  let name: HTMLInputElement | undefined

  const dispatch = (event: CustomSubmitEvent) => {
    const result = transitionCustomSubmit(untrack(submit), event)
    setSubmit(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: CustomSubmitEffect) => {
    if (effect.type === "save")
      return void sdk.api.experimental.provider.custom.create({ ...effect.input, location: props.location }).then(
        () => dispatch({ type: "save.succeeded", attempt: effect.attempt }),
        (error) =>
          dispatch({ type: "save.failed", attempt: effect.attempt, error: formatServerError(error, language.t) }),
      )

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer = setTimeout(() => dispatch({ type: "timed-out", attempt: effect.attempt }), effect.timeoutMs)

      return
    }

    if (effect.type === "timer.stop") return clearTimeout(timer)

    props.onCreated(effect.providerID, effect.firstModel)
  }

  // The location's models refresh on `model.updated`, which the server sends once the new provider loads.
  createEffect(() => {
    const state = submit()

    if (state.status !== "loading") return
    const model = (data.location.model.list(props.location) ?? []).find(
      (item) => item.providerID === state.providerID && item.enabled,
    )

    if (model) untrack(() => dispatch({ type: "models.loaded", attempt: state.attempt, firstModel: modelKey(model) }))
  })

  onMount(() => name?.focus({ preventScroll: true }))
  onCleanup(() => dispatch({ type: "disposed" }))

  const error = (key: string) => {
    const value = store.errors[key]

    return value ? language.t(ERROR_LABEL[value]) : undefined
  }

  // Store writes merge objects, so errors are deleted key by key and replaced with `reconcile`.
  const clear = (...keys: string[]) =>
    setStore(
      "errors",
      produce((errors) => keys.forEach((key) => delete errors[key])),
    )

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault()

    if (view().busy) return
    const result = validateCustomProvider(store, props.taken())

    if (result.type === "valid") return dispatch({ type: "submitted", input: result.input })
    setStore("errors", reconcile({ ...result.errors }))
    // Move to the first field that needs attention.
    queueMicrotask(() => form?.querySelector<HTMLInputElement>("[aria-invalid=true]")?.focus())
  }

  return (
    <form
      ref={form}
      class="flex min-h-0 flex-1 flex-col"
      onSubmit={onSubmit}
      novalidate
      data-component="custom-provider-form"
    >
      <div
        data-scrollable
        class="flex min-h-0 flex-1 flex-col items-start gap-5 overflow-y-auto px-2 pb-1 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted"
      >
        <p>{language.t("provider.custom.description")}</p>

        <RadioGroup
          label={language.t("provider.custom.protocol.label")}
          value={store.package}
          onChange={(value) => {
            const next = CUSTOM_PROVIDER_PACKAGES.find((item) => item === value)

            if (next) setStore("package", next)
          }}
        >
          <For each={CUSTOM_PROVIDER_PACKAGES}>
            {(item) => <RadioItem value={item} label={language.t(PACKAGE_LABEL[item])} disabled={view().busy} />}
          </For>
        </RadioGroup>

        <div class="grid w-full grid-cols-2 gap-3">
          <TextField
            label={language.t("provider.custom.name.label")}
            placeholder={language.t("provider.custom.name.placeholder")}
            value={store.name}
            error={error("name")}
            readOnly={view().busy}
            ref={(el) => (name = el)}
            onInput={(value) => {
              setStore({ name: value, ...(store.idEdited ? {} : { id: customProviderID(value) }) })
              clear("name", ...(store.idEdited ? [] : ["id"]))
            }}
          />
          <TextField
            label={language.t("provider.custom.id.label")}
            placeholder={language.t("provider.custom.id.placeholder")}
            value={store.id}
            error={error("id")}
            readOnly={view().busy}
            code
            onInput={(value) => {
              setStore({ id: value, idEdited: value !== "" })
              clear("id")
            }}
          />
        </div>

        <TextField
          label={language.t("provider.custom.baseURL.label")}
          placeholder={language.t("provider.custom.baseURL.placeholder")}
          value={store.baseURL}
          error={error("baseURL")}
          readOnly={view().busy}
          type="url"
          code
          onInput={(value) => {
            setStore("baseURL", value)
            clear("baseURL")
          }}
        />

        <TextField
          label={language.t("provider.custom.apiKey.label")}
          hint={language.t("provider.custom.apiKey.hint")}
          placeholder={language.t("provider.connect.apiKey.placeholder")}
          value={store.apiKey}
          readOnly={view().busy}
          type="password"
          onInput={(value) => setStore("apiKey", value)}
        />

        <Rows
          label={language.t("provider.custom.models.label")}
          error={error("models")}
          add={language.t("provider.custom.models.add")}
          disabled={view().busy}
          onAdd={() => {
            setStore("models", (models) => [...models, { key: row(), id: "", name: "" }])
            clear("models")
          }}
        >
          <For each={store.models}>
            {(model, index) => (
              <Row
                error={error(`models.${model.key}`)}
                remove={language.t("provider.custom.models.remove")}
                disabled={view().busy}
                canRemove={store.models.length > 1}
                onRemove={() => {
                  setStore("models", (models) => models.filter((item) => item.key !== model.key))
                  clear(`models.${model.key}`)
                }}
              >
                <TextInput
                  class="min-w-0 flex-1 [&_input]:[font-family:var(--v2-font-family-code)]"
                  aria-label={language.t("provider.custom.models.id")}
                  placeholder={language.t("provider.custom.models.id.placeholder")}
                  value={model.id}
                  invalid={!!store.errors[`models.${model.key}`]}
                  readOnly={view().busy}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => {
                    setStore("models", index(), "id", event.currentTarget.value)
                    clear(`models.${model.key}`, "models")
                  }}
                />
                <TextInput
                  class="min-w-0 flex-1"
                  aria-label={language.t("provider.custom.models.name")}
                  placeholder={language.t("provider.custom.models.name.placeholder")}
                  value={model.name}
                  readOnly={view().busy}
                  autocomplete="off"
                  onInput={(event) => setStore("models", index(), "name", event.currentTarget.value)}
                />
              </Row>
            )}
          </For>
        </Rows>

        <Rows
          label={language.t("provider.custom.headers.label")}
          hint={language.t("provider.custom.headers.hint")}
          add={language.t("provider.custom.headers.add")}
          disabled={view().busy}
          onAdd={() => setStore("headers", (headers) => [...headers, { key: row(), name: "", value: "" }])}
        >
          <For each={store.headers}>
            {(header, index) => (
              <Row
                error={error(`headers.${header.key}`)}
                remove={language.t("provider.custom.headers.remove")}
                disabled={view().busy}
                canRemove
                onRemove={() => {
                  setStore("headers", (headers) => headers.filter((item) => item.key !== header.key))
                  clear(`headers.${header.key}`)
                }}
              >
                <TextInput
                  class="min-w-0 flex-1 [&_input]:[font-family:var(--v2-font-family-code)]"
                  aria-label={language.t("provider.custom.headers.name")}
                  placeholder={language.t("provider.custom.headers.name.placeholder")}
                  value={header.name}
                  invalid={!!store.errors[`headers.${header.key}`] && !header.name.trim()}
                  readOnly={view().busy}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => {
                    setStore("headers", index(), "name", event.currentTarget.value)
                    clear(`headers.${header.key}`)
                  }}
                />
                <TextInput
                  class="min-w-0 flex-1 [&_input]:[font-family:var(--v2-font-family-code)]"
                  aria-label={language.t("provider.custom.headers.value")}
                  placeholder={language.t("provider.custom.headers.value.placeholder")}
                  value={header.value}
                  invalid={!!store.errors[`headers.${header.key}`] && !header.value.trim()}
                  readOnly={view().busy}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => {
                    setStore("headers", index(), "value", event.currentTarget.value)
                    clear(`headers.${header.key}`)
                  }}
                />
              </Row>
            )}
          </For>
        </Rows>
      </div>

      <div class="flex shrink-0 flex-col gap-3 px-2 pt-4 text-[13px] font-[440] leading-5 tracking-[-0.04px]">
        <Show when={view().error}>
          {(message) => (
            <div class="flex items-start gap-2 text-v2-text-text-base">
              <Icon name="circle-ban-sign" class="mt-0.5 shrink-0 text-v2-state-fg-danger" />
              <span role="alert">{message()}</span>
            </div>
          )}
        </Show>
        <StepActions>
          <Show when={view().phase}>
            {(phase) => (
              <span class="me-auto flex items-center gap-2 text-v2-text-text-muted" aria-live="polite">
                <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
                {language.t(phase() === "loading" ? "provider.custom.status.loading" : "provider.custom.status.saving")}
              </span>
            )}
          </Show>
          <Button
            type="submit"
            variant="submit"
            data-action="custom-provider-submit"
            disabled={view().busy}
            aria-busy={view().busy}
          >
            {language.t("provider.custom.submit")}
          </Button>
        </StepActions>
      </div>
    </form>
  )
}

function TextField(props: {
  label: string
  hint?: string
  placeholder: string
  value: string
  error?: string
  readOnly: boolean
  type?: "text" | "url" | "password"
  code?: boolean
  ref?: (el: HTMLInputElement) => void
  onInput: (value: string) => void
}) {
  const errorID = createUniqueId()

  return (
    <div class="flex w-full min-w-0 flex-col gap-2">
      <label class={LABEL_CLASS}>
        <span class="flex items-baseline gap-1.5">
          {props.label}
          <Show when={props.hint}>
            <span class="font-[440] text-v2-text-text-faint">{props.hint}</span>
          </Show>
        </span>
        <TextInput
          ref={props.ref}
          class="!w-full"
          classList={{ "[&_input]:[font-family:var(--v2-font-family-code)]": !!props.code }}
          appearance="large"
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          value={props.value}
          readOnly={props.readOnly}
          invalid={props.error !== undefined}
          aria-describedby={props.error ? errorID : undefined}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      </label>
      <Show when={props.error}>
        {(message) => (
          <div id={errorID} class="text-xs text-v2-state-fg-danger">
            {message()}
          </div>
        )}
      </Show>
    </div>
  )
}

function Rows(props: {
  label: string
  hint?: string
  error?: string
  add: string
  disabled: boolean
  onAdd: () => void
  children: JSX.Element
}) {
  return (
    <div role="group" aria-label={props.label} class="flex w-full flex-col gap-2">
      <div class="flex items-baseline gap-1.5 font-[530] leading-4 text-v2-text-text-base">
        {props.label}
        <Show when={props.hint}>
          <span class="font-[440] text-v2-text-text-faint">{props.hint}</span>
        </Show>
      </div>
      {props.children}
      <Show when={props.error}>{(message) => <div class="text-xs text-v2-state-fg-danger">{message()}</div>}</Show>
      <Button
        type="button"
        variant="ghost-muted"
        size="small"
        class="self-start"
        icon="plus"
        disabled={props.disabled}
        onClick={props.onAdd}
      >
        {props.add}
      </Button>
    </div>
  )
}

function Row(props: {
  error?: string
  remove: string
  disabled: boolean
  canRemove: boolean
  onRemove: () => void
  children: JSX.Element
}) {
  return (
    <div class="flex w-full flex-col gap-1">
      <div class="flex w-full items-center gap-2">
        {props.children}
        <IconButton
          type="button"
          variant="ghost-muted"
          icon={<Icon name="trash" />}
          aria-label={props.remove}
          disabled={props.disabled || !props.canRemove}
          onClick={props.onRemove}
        />
      </div>
      <Show when={props.error}>{(message) => <div class="text-xs text-v2-state-fg-danger">{message()}</div>}</Show>
    </div>
  )
}
