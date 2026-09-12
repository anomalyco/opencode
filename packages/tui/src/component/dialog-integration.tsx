import { useLanguage } from "../context/language"
import { TextAttributes } from "@opentui/core"
import type {
  ConnectionInfo,
  IntegrationCommandConnectOutput,
  IntegrationInfo,
  IntegrationOauthConnectOutput,
  IntegrationOAuthMethod,
  FormAnswer,
  FormField,
  FormFields,
  FormValue,
  LocationRef,
} from "@opencode/client"
import open from "open"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"
import { formLabel, formToggleMultiselect, formValidateValue, type FormAnswerField } from "../util/form"

const INTEGRATION_PRIORITY: Record<string, number> = {
  "opencode-go": 0,
  opencode: 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

type ConnectMethod = Exclude<IntegrationInfo["methods"][number], { type: "env" }>
type IntegrationAttempt = IntegrationOauthConnectOutput["data"]
type CommandAttempt = IntegrationCommandConnectOutput["data"]
type OnIntegrationConnected = (providerID?: string) => void
type Language = ReturnType<typeof useLanguage>
const CANCELLED = Symbol("cancelled")
const CUSTOM = Symbol("custom")
const OPEN = Symbol("open")
const SUBMIT = Symbol("submit")

export function integrationOptions(list: IntegrationInfo[]) {
  return list.toSorted(
    (a, b) =>
      Number(b.metadata?.source === "mcp") - Number(a.metadata?.source === "mcp") ||
      (INTEGRATION_PRIORITY[a.id] ?? 99) - (INTEGRATION_PRIORITY[b.id] ?? 99) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  )
}

export function connectMethods(integration: IntegrationInfo): ConnectMethod[] {
  return integration.methods
    .filter((method): method is ConnectMethod => method.type !== "env")
    .toSorted((a, b) => Number(a.type === "key") - Number(b.type === "key"))
}

export function credentialConnections(integration: IntegrationInfo) {
  return integration.connections.filter(
    (connection): connection is Extract<ConnectionInfo, { type: "credential" }> => connection.type === "credential",
  )
}

export function connectionSummary(integration: IntegrationInfo) {
  return integration.connections
    .map((connection) => (connection.type === "credential" ? connection.label : `$${connection.name}`))
    .join(", ")
}

export function DialogIntegration(
  props: { onConnected?: OnIntegrationConnected; integrationID?: string; autoConnect?: boolean } = {},
) {
  const data = useData()
  const currentLocation = useLocation()
  const dialog = useDialog()
  const language = useLanguage()
  const theme = useTheme("elevated")
  const location = currentLocation.ref ?? data.location.default()
  const integrations = createMemo(() =>
    integrationOptions(data.location.integration.list(location) ?? []).filter(
      (integration) => props.integrationID === undefined || integration.id === props.integrationID,
    ),
  )

  createEffect(() => {
    if (!props.autoConnect) return
    const integration = integrations()[0]
    if (!integration) return
    const methods = connectMethods(integration)
    if (credentialConnections(integration).length) {
      manageConnections(integration, methods, location, dialog, language, props.onConnected)
      return
    }
    selectMethod(integration, methods, location, dialog, language, props.onConnected)
  })

  const options = createMemo(() => {
    const providers = data.location.websearch.list(location) ?? []
    const providersByID = new Map(providers.map((provider) => [provider.id, provider]))
    return integrations().map((integration) => {
      const methods = connectMethods(integration)
      const provider = providersByID.get(integration.id)
      const credentials = credentialConnections(integration)
      const category =
        integration.metadata?.source === "mcp"
          ? "MCP"
          : language.t(
              provider
                ? "tui.dialogs.webSearch"
                : integration.id in INTEGRATION_PRIORITY
                  ? "tui.dialogs.popular"
                  : "tui.dialogs.services",
            )
      return {
        title: integration.name,
        value: integration.id,
        description: methods.length === 0 ? language.t("tui.projects.environmentOnly") : undefined,
        footer: connectionSummary(integration) || undefined,
        category,
        disabled: methods.length === 0 && credentials.length === 0,
        gutter:
          integration.connections.length > 0
            ? () => <text fg={theme.text.feedback.success.default}>✓</text>
            : undefined,
        onSelect: () => {
          if (credentials.length)
            return manageConnections(integration, methods, location, dialog, language, props.onConnected)
          return selectMethod(integration, methods, location, dialog, language, props.onConnected)
        },
      }
    })
  })

  return (
    <DialogSelect
      title={language.t("tui.connectAnIntegration")}
      options={options()}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>{language.t("tui.projects.noIntegrationsAvailable")}</text>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>{language.t("tui.projects.noIntegrationsFound")}</text>
        </box>
      }
    />
  )
}

function manageConnections(
  integration: IntegrationInfo,
  methods: ConnectMethod[],
  location: LocationRef,
  dialog: ReturnType<typeof useDialog>,
  language: Language,
  onConnected?: OnIntegrationConnected,
) {
  dialog.replace(() => {
    const data = useData()
    const client = useClient()
    const toast = useToast()
    const theme = useTheme("elevated")
    const shortcuts = Keymap.useShortcuts()
    const [deleting, setDeleting] = createSignal<string>()
    const [selected, setSelected] = createSignal(methods.length ? "add" : credentialConnections(integration)[0]?.id)
    const current = createMemo(() =>
      data.location.integration.list(location)?.find((item) => item.id === integration.id),
    )

    return (
      <DialogSelect
        title={integration.name}
        current={credentialConnections(current() ?? integration)[0]?.id}
        focusCurrent={false}
        preserveSelection
        onMove={(option) => {
          setSelected(option.value)
          setDeleting(undefined)
        }}
        options={[
          ...(methods.length
            ? [
                {
                  title: language.t("tui.dialogs.addAccount"),
                  value: "add",
                  onSelect: () =>
                    selectMethod(current() ?? integration, methods, location, dialog, language, onConnected),
                },
              ]
            : []),
          ...credentialConnections(current() ?? integration)
            .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
            .map((connection) => {
              const confirming = deleting() === connection.id
              return {
                title: confirming
                  ? language.t("tui.pressKeyAgainToConfirm", { key: shortcuts.get("dialog.integration.delete") ?? "" })
                  : connection.label,
                value: connection.id,
                category: language.t("tui.dialogs.connectedAccounts"),
                bg: confirming ? theme.background.action.destructive.focused : undefined,
                fg: confirming ? theme.text.action.destructive.focused : undefined,
                onSelect: () => {
                  if (credentialConnections(current() ?? integration)[0]?.id === connection.id) return
                  void client.api.credential
                    .activate({ credentialID: connection.id, location: locationQuery(location) })
                    .catch(toast.error)
                },
              }
            }),
        ]}
        actions={[
          {
            command: "dialog.integration.rename",
            title: language.t("tui.rename"),
            hidden: selected() === "add",
            disabled: (option) => !option || option.value === "add",
            onTrigger: (option) => {
              dialog.replace(() => (
                <DialogPrompt
                  title={language.t("tui.dialogs.renameAccount")}
                  placeholder={language.t("tui.dialogs.accountName")}
                  value={
                    credentialConnections(current() ?? integration).find((item) => item.id === option.value)?.label
                  }
                  onConfirm={(value) => {
                    const label = value.trim()
                    if (!label) return
                    void client.api.credential
                      .update({ credentialID: option.value, label, location: locationQuery(location) })
                      .then(() => manageConnections(integration, methods, location, dialog, language, onConnected))
                      .catch(toast.error)
                  }}
                />
              ))
            },
          },
          {
            command: "dialog.integration.delete",
            title: language.t("tui.delete"),
            hidden: selected() === "add",
            disabled: (option) => !option || option.value === "add",
            onTrigger: (option) => {
              if (deleting() !== option.value) return setDeleting(option.value)
              const final = credentialConnections(current() ?? integration).length === 1
              void client.api.credential
                .remove({ credentialID: option.value, location: locationQuery(location) })
                .then(() => {
                  setDeleting(undefined)
                  if (!final) return
                  toast.show({
                    variant: "success",
                    message: language.t("tui.dialogs.disconnectedIntegration", { name: integration.name }),
                  })
                  dialog.clear()
                })
                .catch((error) => {
                  setDeleting(undefined)
                  toast.error(error)
                })
            },
          },
        ]}
      />
    )
  })
}

function selectMethod(
  integration: IntegrationInfo,
  methods: ConnectMethod[],
  location: LocationRef,
  dialog: ReturnType<typeof useDialog>,
  language: Language,
  onConnected?: OnIntegrationConnected,
) {
  if (methods.length === 1) return openMethod(integration, methods[0], location, dialog, language, onConnected)
  dialog.replace(() => (
    <DialogSelect
      title={language.t("tui.dialogs.connectIntegration", { name: integration.name })}
      options={methods.map((method) => ({
        title: method.type === "key" ? (method.label ?? language.t("tui.dialogs.apiKey")) : method.label,
        value: method.type === "key" ? "key" : method.id,
        onSelect: () => openMethod(integration, method, location, dialog, language, onConnected),
      }))}
    />
  ))
}

function openMethod(
  integration: IntegrationInfo,
  method: ConnectMethod,
  location: LocationRef,
  dialog: ReturnType<typeof useDialog>,
  language: Language,
  onConnected?: OnIntegrationConnected,
) {
  if (method.type === "key") {
    void beginKey(integration, method, location, dialog, language, onConnected)
    return
  }
  if (method.type === "command") {
    dialog.replace(() => (
      <CommandStarting integration={integration} method={method} location={location} onConnected={onConnected} />
    ))
    return
  }
  void beginOAuth(integration, method, location, dialog, language, onConnected)
}

async function beginKey(
  integration: IntegrationInfo,
  method: Extract<ConnectMethod, { type: "key" }>,
  location: LocationRef,
  dialog: ReturnType<typeof useDialog>,
  language: Language,
  onConnected?: OnIntegrationConnected,
) {
  const answer = method.form
    ? await formAnswer(
        dialog,
        method.label ?? language.t("tui.dialogs.connectIntegration", { name: integration.name }),
        method.form,
        language,
      )
    : undefined
  if (answer === null) return
  dialog.replace(() => (
    <KeyMethod
      integration={integration}
      method={method}
      location={location}
      answer={answer}
      onConnected={onConnected}
    />
  ))
}

function CommandStarting(props: {
  integration: IntegrationInfo
  method: Extract<ConnectMethod, { type: "command" }>
  location: LocationRef
  onConnected?: OnIntegrationConnected
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const client = useClient()
  const toast = useToast()
  let closed = false
  let handedOff = false

  onMount(() => {
    void client.api.integration.command
      .connect({
        integrationID: props.integration.id,
        methodID: props.method.id,
        location: locationQuery(props.location),
      })
      .then((result) => {
        if (closed) {
          void client.api.integration.command.cancel({
            integrationID: props.integration.id,
            attemptID: result.data.attemptID,
            location: locationQuery(props.location),
          })
          return
        }
        handedOff = true
        dialog.replace(() => (
          <CommandPending
            integration={props.integration}
            title={props.method.label}
            attempt={result.data}
            location={props.location}
            onConnected={props.onConnected}
          />
        ))
      })
      .catch((cause) => {
        if (closed) return
        toast.show({ variant: "error", message: message(cause, language) })
        dialog.clear()
      })
  })
  onCleanup(() => {
    if (!handedOff) closed = true
  })

  return <CommandView title={props.method.label} output="" message={language.t("tui.dialogs.startingCommand")} />
}

function CommandPending(props: {
  integration: IntegrationInfo
  title: string
  attempt: CommandAttempt
  location: LocationRef
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const language = useLanguage()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const [output, setOutput] = createSignal("")
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false

  const poll = () => {
    void client.api.integration.command
      .status({
        integrationID: props.integration.id,
        attemptID: props.attempt.attemptID,
        location: locationQuery(props.location),
      })
      .then((result) => {
        const status = result.data
        if (status.status === "pending") {
          setOutput(status.message ?? "")
          timer = setTimeout(poll, 500)
          return
        }
        settled = true
        if (status.status === "complete") {
          void connected(props.integration, props.location, data, dialog, toast, language, props.onConnected)
          return
        }
        toast.show({
          variant: "error",
          message: status.status === "failed" ? status.message : language.t("tui.dialogs.authenticationExpired"),
        })
        dialog.clear()
      })
      .catch((cause) => {
        settled = true
        toast.show({ variant: "error", message: message(cause, language) })
        dialog.clear()
      })
  }

  onMount(poll)
  onCleanup(() => {
    if (timer) clearTimeout(timer)
    if (settled) return
    void client.api.integration.command.cancel({
      integrationID: props.integration.id,
      attemptID: props.attempt.attemptID,
      location: locationQuery(props.location),
    })
  })

  return <CommandView title={props.title} output={output()} message={language.t("tui.dialogs.waitingCommand")} />
}

function CommandView(props: { title: string; output: string; message: string }) {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const overlayTheme = useTheme("overlay")
  onMount(() => dialog.setSize("large"))
  return (
    <box gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {props.title}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc {language.t("tui.details.close")}
        </text>
      </box>
      <box
        backgroundColor={overlayTheme.background.default}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg={overlayTheme.text.default}>{props.output.trim()}</text>
      </box>
      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.text.subdued}>{props.message}</text>
      </box>
    </box>
  )
}

function KeyMethod(props: {
  integration: IntegrationInfo
  method: Extract<ConnectMethod, { type: "key" }>
  location: LocationRef
  answer?: FormAnswer
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const language = useLanguage()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const theme = useTheme("elevated")
  const [error, setError] = createSignal<string>()

  return (
    <DialogPrompt
      title={props.method.label ?? language.t("tui.dialogs.connectIntegration", { name: props.integration.name })}
      placeholder={language.t("tui.dialogs.apiKey")}
      onConfirm={(key) => {
        if (!key) return
        void client.api.integration.connect
          .key({
            integrationID: props.integration.id,
            location: locationQuery(props.location),
            key,
            ...(props.answer ? { answer: props.answer } : {}),
          })
          .then(() => connected(props.integration, props.location, data, dialog, toast, language, props.onConnected))
          .catch((cause) => setError(message(cause, language)))
      }}
      description={() => (
        <Show when={error()}>{(value) => <text fg={theme.text.feedback.error.default}>{value()}</text>}</Show>
      )}
    />
  )
}

async function beginOAuth(
  integration: IntegrationInfo,
  method: IntegrationOAuthMethod,
  location: LocationRef,
  dialog: ReturnType<typeof useDialog>,
  language: Language,
  onConnected?: OnIntegrationConnected,
) {
  const answer = method.form ? await formAnswer(dialog, method.label, method.form, language) : undefined
  if (answer === null) return
  dialog.replace(() => (
    <OAuthStarting
      integration={integration}
      method={method}
      location={location}
      answer={answer}
      onConnected={onConnected}
    />
  ))
}

function OAuthStarting(props: {
  integration: IntegrationInfo
  method: IntegrationOAuthMethod
  location: LocationRef
  answer?: FormAnswer
  onConnected?: OnIntegrationConnected
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const client = useClient()
  const toast = useToast()

  onMount(() => {
    void client.api.integration.oauth
      .connect({
        integrationID: props.integration.id,
        location: locationQuery(props.location),
        methodID: props.method.id,
        ...(props.answer ? { answer: props.answer } : {}),
      })
      .then((result) => {
        if (result.data.mode === "code") {
          dialog.replace(() => (
            <OAuthCode
              integration={props.integration}
              title={props.method.label}
              attempt={result.data}
              location={props.location}
              onConnected={props.onConnected}
            />
          ))
          return
        }
        dialog.replace(() => (
          <OAuthAuto
            integration={props.integration}
            title={props.method.label}
            attempt={result.data}
            location={props.location}
            onConnected={props.onConnected}
          />
        ))
      })
      .catch((cause) => {
        toast.show({ variant: "error", message: message(cause, language) })
        dialog.clear()
      })
  })

  return <OAuthView title={props.method.label} message={language.t("tui.dialogs.startingAuthorization")} />
}

function OAuthAuto(props: {
  integration: IntegrationInfo
  title: string
  attempt: IntegrationAttempt
  location: LocationRef
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const language = useLanguage()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const clipboard = useClipboard()
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "o",
        title: language.t("tui.dialogs.openAuthorizationURL"),
        group: language.t("tui.dialog"),
        run: () => {
          open(props.attempt.url).catch(() =>
            toast.show({
              message: language.t("tui.form.browserFailed"),
              variant: "error",
            }),
          )
        },
      },
      {
        bind: "c",
        title: language.t("tui.dialogs.copyAuthorization"),
        group: language.t("tui.dialog"),
        run: () => {
          const value = props.attempt.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.attempt.url
          clipboard
            .write(value)
            .then(() => toast.show({ message: language.t("tui.session.copiedToClipboard"), variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  const poll = () => {
    void client.api.integration.oauth
      .status({
        integrationID: props.integration.id,
        attemptID: props.attempt.attemptID,
        location: locationQuery(props.location),
      })
      .then((result) => {
        const status = result.data
        if (status.status === "pending") {
          timer = setTimeout(poll, 500)
          return
        }
        settled = true
        if (status.status === "complete") {
          void connected(props.integration, props.location, data, dialog, toast, language, props.onConnected)
          return
        }
        toast.show({
          variant: "error",
          message: status.status === "failed" ? status.message : language.t("tui.dialogs.authorizationExpired"),
        })
        dialog.clear()
      })
      .catch((cause) => {
        settled = true
        toast.show({ variant: "error", message: message(cause, language) })
        dialog.clear()
      })
  }

  onMount(poll)
  onCleanup(() => {
    if (timer) clearTimeout(timer)
    if (settled) return
    void client.api.integration.oauth.cancel({
      integrationID: props.integration.id,
      attemptID: props.attempt.attemptID,
      location: locationQuery(props.location),
    })
  })

  return (
    <OAuthView
      title={props.title}
      url={props.attempt.url}
      instructions={props.attempt.instructions}
      message={language.t("tui.dialogs.waitingAuthorization")}
      copy
      open
    />
  )
}

function OAuthCode(props: {
  integration: IntegrationInfo
  title: string
  attempt: IntegrationAttempt
  location: LocationRef
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const language = useLanguage()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const theme = useTheme("elevated")
  const [error, setError] = createSignal<string>()
  let settled = false

  onCleanup(() => {
    if (settled) return
    void client.api.integration.oauth.cancel({
      integrationID: props.integration.id,
      attemptID: props.attempt.attemptID,
      location: locationQuery(props.location),
    })
  })

  return (
    <DialogPrompt
      title={props.title}
      placeholder={language.t("tui.dialogs.authorizationCode")}
      onConfirm={(code) => {
        if (!code) return
        void client.api.integration.oauth
          .complete({
            integrationID: props.integration.id,
            attemptID: props.attempt.attemptID,
            location: locationQuery(props.location),
            code,
          })
          .then(() => {
            settled = true
            return connected(props.integration, props.location, data, dialog, toast, language, props.onConnected)
          })
          .catch((cause) => setError(message(cause, language)))
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.text.subdued}>{props.attempt.instructions}</text>
          <Link href={props.attempt.url} fg={theme.markdown.link} />
          <Show when={error()}>{(value) => <text fg={theme.text.feedback.error.default}>{value()}</text>}</Show>
        </box>
      )}
    />
  )
}

function OAuthView(props: {
  title: string
  url?: string
  instructions?: string
  message: string
  copy?: boolean
  open?: boolean
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const theme = useTheme("elevated")
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {props.title}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={props.url}>
        {(url) => (
          <box gap={1}>
            <Link href={url()} fg={theme.markdown.link} />
            <Show when={props.instructions}>
              {(instructions) => <text fg={theme.text.subdued}>{instructions()}</text>}
            </Show>
          </box>
        )}
      </Show>
      <text fg={theme.text.subdued}>{props.message}</text>
      <box flexDirection="row" gap={2}>
        <Show when={props.open}>
          <text fg={theme.text.default}>
            o <span style={{ fg: theme.text.subdued }}>{language.t("tui.dialogs.openHint")}</span>
          </text>
        </Show>
        <Show when={props.copy}>
          <text fg={theme.text.default}>
            c <span style={{ fg: theme.text.subdued }}>{language.t("tui.session.copy")}</span>
          </text>
        </Show>
      </box>
    </box>
  )
}

async function formAnswer(dialog: ReturnType<typeof useDialog>, title: string, fields: FormFields, language: Language) {
  const answer: FormAnswer = {}
  for (const field of fields) {
    if (!active(field, answer)) continue
    const value = await fieldAnswer(dialog, title, field, language)
    if (value === CANCELLED) return null
    if (value !== undefined) answer[field.key] = value
  }
  return answer
}

function active(field: FormField, answer: FormAnswer) {
  if (field.type === "external" || !field.when) return true
  return field.when.every((when) => {
    const value = answer[when.key]
    if (value === undefined) return false
    const hit = Array.isArray(value) ? value.includes(String(when.value)) : value === when.value
    return when.op === "eq" ? hit : !hit
  })
}

function fieldAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: FormField,
  language: Language,
): Promise<FormValue | undefined | typeof CANCELLED> {
  if (field.type === "external") return externalAnswer(dialog, title, field, language)
  if (field.type === "multiselect") return multiselectAnswer(dialog, title, field, language)
  if (field.type === "boolean" || (field.type === "string" && field.options)) {
    return selectAnswer(dialog, title, field, language)
  }
  return textAnswer(dialog, title, field, language)
}

async function selectAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormAnswerField, { type: "boolean" | "string" }>,
  language: Language,
): Promise<FormValue | undefined | typeof CANCELLED> {
  const options =
    field.type === "boolean"
      ? field.default === false
        ? [
            { title: language.t("tui.form.no"), value: false as FormValue },
            { title: language.t("tui.form.yes"), value: true as FormValue },
          ]
        : [
            { title: language.t("tui.form.yes"), value: true as FormValue },
            { title: language.t("tui.form.no"), value: false as FormValue },
          ]
      : (field.options ?? []).map((option) => ({
          title: option.label,
          value: option.value as FormValue,
          description: option.description,
        }))
  const choice = await new Promise<FormValue | typeof CUSTOM | undefined | typeof CANCELLED>((resolve) => {
    dialog.replace(
      () => (
        <DialogSelect<FormValue | typeof CUSTOM | undefined>
          title={formLabel(field) || title}
          options={[
            ...options,
            ...(field.type === "string" && field.custom
              ? [{ title: language.t("tui.details.typeYourOwnAnswer"), value: CUSTOM as typeof CUSTOM }]
              : []),
            ...(!field.required ? [{ title: language.t("tui.dialogs.skip"), value: undefined }] : []),
          ]}
          current={field.type === "string" ? field.default : undefined}
          onSelect={(option) => resolve(option.value)}
        />
      ),
      () => resolve(CANCELLED),
    )
  })
  if (choice === CUSTOM) {
    if (field.type !== "string") return CANCELLED
    return textAnswer(dialog, title, field, language, "")
  }
  return choice
}

function textAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormAnswerField, { type: "string" | "number" | "integer" }>,
  language: Language,
  initial = field.default === undefined ? undefined : String(field.default),
): Promise<FormValue | undefined | typeof CANCELLED> {
  return new Promise<FormValue | undefined | typeof CANCELLED>((resolve) => {
    dialog.replace(
      () => {
        const theme = useTheme("elevated")
        const [error, setError] = createSignal<string>()
        return (
          <DialogPrompt
            title={formLabel(field) || title}
            placeholder={field.type === "string" ? field.placeholder : undefined}
            value={initial}
            onConfirm={(input) => {
              const text = input.trim()
              const value = text === "" && !field.required ? undefined : field.type === "string" ? text : Number(text)
              const invalid = formValidateValue(field, value, language.t)
              if (invalid) {
                setError(invalid)
                return
              }
              resolve(value)
            }}
            description={() => (
              <box gap={1}>
                <Show when={field.description}>
                  {(description) => <text fg={theme.text.subdued}>{description()}</text>}
                </Show>
                <Show when={error()}>{(value) => <text fg={theme.text.feedback.error.default}>{value()}</text>}</Show>
              </box>
            )}
          />
        )
      },
      () => resolve(CANCELLED),
    )
  })
}

async function multiselectAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormAnswerField, { type: "multiselect" }>,
  language: Language,
): Promise<FormValue | typeof CANCELLED> {
  const selected = field.default ? [...field.default] : []
  while (true) {
    const invalid = formValidateValue(field, selected, language.t)
    const choice = await new Promise<string | typeof CUSTOM | typeof SUBMIT | typeof CANCELLED>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect<string | typeof CUSTOM | typeof SUBMIT>
            title={formLabel(field) || title}
            options={[
              ...field.options.map((option) => ({
                title: `[${selected.includes(option.value) ? "x" : " "}] ${option.label}`,
                value: option.value,
                description: option.description,
                disabled:
                  !selected.includes(option.value) && field.maxItems !== undefined && selected.length >= field.maxItems,
              })),
              ...(field.custom
                ? [{ title: language.t("tui.details.typeYourOwnAnswer"), value: CUSTOM as typeof CUSTOM }]
                : []),
              {
                title: language.t("tui.session.continue"),
                value: SUBMIT as typeof SUBMIT,
                description: invalid,
                disabled: invalid !== undefined,
              },
            ]}
            onSelect={(option) => resolve(option.value)}
          />
        ),
        () => resolve(CANCELLED),
      )
    })
    if (choice === CANCELLED) return CANCELLED
    if (choice === SUBMIT) return selected
    if (choice === CUSTOM) {
      const value = await customAnswer(dialog, title, field, language)
      if (value === CANCELLED) return CANCELLED
      if (value && !selected.includes(value)) selected.push(value)
      continue
    }
    selected.splice(0, selected.length, ...formToggleMultiselect(selected, choice))
  }
}

function customAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormAnswerField, { type: "multiselect" }>,
  language: Language,
): Promise<string | typeof CANCELLED> {
  return new Promise<string | typeof CANCELLED>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt
          title={formLabel(field) || title}
          placeholder={language.t("tui.details.typeYourOwnAnswer")}
          onConfirm={(value) => {
            if (value) resolve(value)
          }}
        />
      ),
      () => resolve(CANCELLED),
    )
  })
}

async function externalAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormField, { type: "external" }>,
  language: Language,
): Promise<true | typeof CANCELLED> {
  let opened = false
  while (true) {
    const choice = await new Promise<true | typeof OPEN | typeof CANCELLED>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect<true | typeof OPEN>
            title={formLabel(field) || title}
            options={[
              {
                title: language.t(opened ? "tui.dialogs.openLinkAgain" : "tui.session.openLink"),
                value: OPEN as typeof OPEN,
                description: field.url,
              },
              {
                title: language.t("tui.details.iFinished"),
                value: true as const,
                description: field.description,
                disabled: !opened,
              },
            ]}
            onSelect={(option) => resolve(option.value)}
          />
        ),
        () => resolve(CANCELLED),
      )
    })
    if (choice === CANCELLED) return CANCELLED
    if (choice === true) return true
    const result = await new Promise<boolean | typeof CANCELLED>((resolve) => {
      dialog.replace(
        () => <OAuthView title={formLabel(field) || title} message={language.t("tui.dialogs.openingLink")} />,
        () => resolve(CANCELLED),
      )
      void open(field.url).then(
        () => resolve(true),
        () => resolve(false),
      )
    })
    if (result === CANCELLED) return CANCELLED
    opened ||= result
  }
}

async function connected(
  integration: IntegrationInfo,
  location: LocationRef,
  data: ReturnType<typeof useData>,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
  language: Language,
  onConnected?: OnIntegrationConnected,
) {
  data.location.integration.invalidate(location)
  data.location.model.invalidate(location)
  data.location.provider.invalidate(location)
  await Promise.all([
    data.location.integration.sync(location),
    data.location.model.sync(location),
    data.location.provider.sync(location),
  ])
  toast.show({
    variant: "success",
    message: language.t("tui.dialogs.connectedIntegration", { name: integration.name }),
  })
  if (onConnected) {
    onConnected(providerID(data, location, integration.id))
    return
  }
  dialog.clear()
}

function providerID(data: ReturnType<typeof useData>, location: LocationRef, integrationID: string) {
  const models = data.location.model.list(location) ?? []
  const matches = (data.location.provider.list(location) ?? []).filter(
    (provider) => provider.integrationID === integrationID || provider.id === integrationID,
  )
  return (
    matches.find((provider) =>
      models.some((model) => model.providerID === provider.id && model.status !== "deprecated"),
    )?.id ?? matches[0]?.id
  )
}

function locationQuery(location: LocationRef) {
  return { directory: location.directory, workspace: location.workspaceID }
}

function message(cause: unknown, language: Language) {
  if (cause instanceof Error) return cause.message
  return language.t("tui.dialogs.authenticationFailed")
}
