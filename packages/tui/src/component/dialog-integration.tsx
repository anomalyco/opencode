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
} from "@opencode-ai/client"
import open from "open"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"
import { formLabel, formToggleMultiselect, formValidateValue, type FormAnswerField } from "../util/form"

const INTEGRATION_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

type ConnectMethod = Exclude<IntegrationInfo["methods"][number], { type: "env" }>
type IntegrationAttempt = IntegrationOauthConnectOutput["data"]
type CommandAttempt = IntegrationCommandConnectOutput["data"]
type OnIntegrationConnected = (providerID?: string) => void
const CANCELLED = Symbol("cancelled")
const CUSTOM = Symbol("custom")
const OPEN = Symbol("open")
const SUBMIT = Symbol("submit")

export function integrationOptions(list: IntegrationInfo[]) {
  return list.toSorted(
    (a, b) =>
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
  props: { onConnected?: OnIntegrationConnected; integrationID?: string; connectionOnly?: boolean } = {},
) {
  const data = useData()
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const options = createMemo(() => {
    const providers = data.location.websearch.list() ?? []
    const providersByID = new Map(providers.map((provider) => [provider.id, provider]))
    const integrations = integrationOptions(data.location.integration.list() ?? []).filter(
      (integration) => props.integrationID === undefined || integration.id === props.integrationID,
    )
    return integrations.map((integration) => {
      const methods = connectMethods(integration)
      const provider = providersByID.get(integration.id)
      const credentials = credentialConnections(integration)
      let category = "Services"
      if (integration.id in INTEGRATION_PRIORITY) category = "Popular"
      if (provider) category = "Web search"
      return {
        title: integration.name,
        value: integration.id,
        description: methods.length === 0 ? "Environment only" : undefined,
        footer: connectionSummary(integration) || undefined,
        category,
        disabled: methods.length === 0 && credentials.length === 0,
        gutter:
          integration.connections.length > 0
            ? () => <text fg={theme.text.feedback.success.default}>✓</text>
            : undefined,
        onSelect: () => {
          if (credentials.length) return manageConnections(integration, methods, dialog, props.onConnected)
          return selectMethod(integration, methods, dialog, props.onConnected)
        },
      }
    })
  })

  return (
    <DialogSelect
      title="Connect an integration"
      options={options()}
      emptyView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>No integrations available</text>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>No integrations found</text>
        </box>
      }
    />
  )
}

function manageConnections(
  integration: IntegrationInfo,
  methods: ConnectMethod[],
  dialog: ReturnType<typeof useDialog>,
  onConnected?: OnIntegrationConnected,
) {
  dialog.replace(() => {
    const data = useData()
    const client = useClient()
    const toast = useToast()
    return (
      <DialogSelect
        title={integration.name}
        options={[
          ...(methods.length
            ? [
                {
                  title: "Add connection",
                  value: "add",
                  onSelect: () => selectMethod(integration, methods, dialog, onConnected),
                },
              ]
            : []),
          ...credentialConnections(integration).map((connection) => ({
            title: `Disconnect ${connection.label}`,
            value: connection.id,
            onSelect: () => {
              void client.api.credential
                .remove({ credentialID: connection.id, location: location(data) })
                .then(() => disconnected(integration.name, data, dialog, toast))
                .catch(toast.error)
            },
          })),
        ]}
      />
    )
  })
}

function selectMethod(
  integration: IntegrationInfo,
  methods: ConnectMethod[],
  dialog: ReturnType<typeof useDialog>,
  onConnected?: OnIntegrationConnected,
) {
  if (methods.length === 1) return openMethod(integration, methods[0], dialog, onConnected)
  dialog.replace(() => (
    <DialogSelect
      title={`Connect ${integration.name}`}
      options={methods.map((method) => ({
        title: method.type === "key" ? (method.label ?? "API key") : method.label,
        value: method.type === "key" ? "key" : method.id,
        onSelect: () => openMethod(integration, method, dialog, onConnected),
      }))}
    />
  ))
}

function openMethod(
  integration: IntegrationInfo,
  method: ConnectMethod,
  dialog: ReturnType<typeof useDialog>,
  onConnected?: OnIntegrationConnected,
) {
  if (method.type === "key") {
    void beginKey(integration, method, dialog, onConnected)
    return
  }
  if (method.type === "command") {
    dialog.replace(() => <CommandStarting integration={integration} method={method} onConnected={onConnected} />)
    return
  }
  void beginOAuth(integration, method, dialog, onConnected)
}

async function beginKey(
  integration: IntegrationInfo,
  method: Extract<ConnectMethod, { type: "key" }>,
  dialog: ReturnType<typeof useDialog>,
  onConnected?: OnIntegrationConnected,
) {
  const answer = method.form
    ? await formAnswer(dialog, method.label ?? `Connect ${integration.name}`, method.form)
    : undefined
  if (answer === null) return
  dialog.replace(() => (
    <KeyMethod integration={integration} method={method} answer={answer} onConnected={onConnected} />
  ))
}

function CommandStarting(props: {
  integration: IntegrationInfo
  method: Extract<ConnectMethod, { type: "command" }>
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  let closed = false
  let handedOff = false

  onMount(() => {
    void client.api.integration.command
      .connect({
        integrationID: props.integration.id,
        methodID: props.method.id,
        location: location(data),
      })
      .then((result) => {
        if (closed) {
          void client.api.integration.command.cancel({
            integrationID: props.integration.id,
            attemptID: result.data.attemptID,
            location: location(data),
          })
          return
        }
        handedOff = true
        dialog.replace(() => (
          <CommandPending
            integration={props.integration}
            title={props.method.label}
            attempt={result.data}
            onConnected={props.onConnected}
          />
        ))
      })
      .catch((cause) => {
        if (closed) return
        toast.show({ variant: "error", message: message(cause) })
        dialog.clear()
      })
  })
  onCleanup(() => {
    if (!handedOff) closed = true
  })

  return <CommandView title={props.method.label} output="" message="Starting command..." />
}

function CommandPending(props: {
  integration: IntegrationInfo
  title: string
  attempt: CommandAttempt
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
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
        location: location(data),
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
          void connected(props.integration, data, dialog, toast, props.onConnected)
          return
        }
        toast.show({
          variant: "error",
          message: status.status === "failed" ? status.message : "Authentication expired",
        })
        dialog.clear()
      })
      .catch((cause) => {
        settled = true
        toast.show({ variant: "error", message: message(cause) })
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
      location: location(data),
    })
  })

  return <CommandView title={props.title} output={output()} message="Waiting for command to finish..." />
}

function CommandView(props: { title: string; output: string; message: string }) {
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
          esc close
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
  answer?: FormAnswer
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const theme = useTheme("elevated")
  const [error, setError] = createSignal<string>()

  return (
    <DialogPrompt
      title={props.method.label ?? `Connect ${props.integration.name}`}
      placeholder="API key"
      onConfirm={(key) => {
        if (!key) return
        void client.api.integration.connect
          .key({
            integrationID: props.integration.id,
            location: location(data),
            key,
            ...(props.answer ? { answer: props.answer } : {}),
          })
          .then(() => connected(props.integration, data, dialog, toast, props.onConnected))
          .catch((cause) => setError(message(cause)))
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
  dialog: ReturnType<typeof useDialog>,
  onConnected?: OnIntegrationConnected,
) {
  const answer = method.form ? await formAnswer(dialog, method.label, method.form) : undefined
  if (answer === null) return
  dialog.replace(() => (
    <OAuthStarting integration={integration} method={method} answer={answer} onConnected={onConnected} />
  ))
}

function OAuthStarting(props: {
  integration: IntegrationInfo
  method: IntegrationOAuthMethod
  answer?: FormAnswer
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()

  onMount(() => {
    void client.api.integration.oauth
      .connect({
        integrationID: props.integration.id,
        location: location(data),
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
            onConnected={props.onConnected}
          />
        ))
      })
      .catch((cause) => {
        toast.show({ variant: "error", message: message(cause) })
        dialog.clear()
      })
  })

  return <OAuthView title={props.method.label} message="Starting authorization..." />
}

function OAuthAuto(props: {
  integration: IntegrationInfo
  title: string
  attempt: IntegrationAttempt
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
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
        title: "Open authorization URL",
        group: "Dialog",
        run: () => {
          open(props.attempt.url).catch(() =>
            toast.show({
              message: "Could not open the browser. Copy the URL and continue manually.",
              variant: "error",
            }),
          )
        },
      },
      {
        bind: "c",
        title: "Copy authorization details",
        group: "Dialog",
        run: () => {
          const value = props.attempt.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.attempt.url
          clipboard
            .write(value)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  const poll = () => {
    void client.api.integration.oauth
      .status({ integrationID: props.integration.id, attemptID: props.attempt.attemptID, location: location(data) })
      .then((result) => {
        const status = result.data
        if (status.status === "pending") {
          timer = setTimeout(poll, 500)
          return
        }
        settled = true
        if (status.status === "complete") {
          void connected(props.integration, data, dialog, toast, props.onConnected)
          return
        }
        toast.show({ variant: "error", message: status.status === "failed" ? status.message : "Authorization expired" })
        dialog.clear()
      })
      .catch((cause) => {
        settled = true
        toast.show({ variant: "error", message: message(cause) })
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
      location: location(data),
    })
  })

  return (
    <OAuthView
      title={props.title}
      url={props.attempt.url}
      instructions={props.attempt.instructions}
      message="Waiting for authorization..."
      copy
      open
    />
  )
}

function OAuthCode(props: {
  integration: IntegrationInfo
  title: string
  attempt: IntegrationAttempt
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
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
      location: location(data),
    })
  })

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={(code) => {
        if (!code) return
        void client.api.integration.oauth
          .complete({
            integrationID: props.integration.id,
            attemptID: props.attempt.attemptID,
            location: location(data),
            code,
          })
          .then(() => {
            settled = true
            return connected(props.integration, data, dialog, toast, props.onConnected)
          })
          .catch((cause) => setError(message(cause)))
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
            o <span style={{ fg: theme.text.subdued }}>open</span>
          </text>
        </Show>
        <Show when={props.copy}>
          <text fg={theme.text.default}>
            c <span style={{ fg: theme.text.subdued }}>copy</span>
          </text>
        </Show>
      </box>
    </box>
  )
}

async function formAnswer(dialog: ReturnType<typeof useDialog>, title: string, fields: FormFields) {
  const answer: FormAnswer = {}
  for (const field of fields) {
    if (!active(field, answer)) continue
    const value = await fieldAnswer(dialog, title, field)
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
): Promise<FormValue | undefined | typeof CANCELLED> {
  if (field.type === "external") return externalAnswer(dialog, title, field)
  if (field.type === "multiselect") return multiselectAnswer(dialog, title, field)
  if (field.type === "boolean" || (field.type === "string" && field.options)) {
    return selectAnswer(dialog, title, field)
  }
  return textAnswer(dialog, title, field)
}

async function selectAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormAnswerField, { type: "boolean" | "string" }>,
): Promise<FormValue | undefined | typeof CANCELLED> {
  const options =
    field.type === "boolean"
      ? field.default === false
        ? [
            { title: "No", value: false as FormValue },
            { title: "Yes", value: true as FormValue },
          ]
        : [
            { title: "Yes", value: true as FormValue },
            { title: "No", value: false as FormValue },
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
              ? [{ title: "Type your own answer", value: CUSTOM as typeof CUSTOM }]
              : []),
            ...(!field.required ? [{ title: "Skip", value: undefined }] : []),
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
    return textAnswer(dialog, title, field, "")
  }
  return choice
}

function textAnswer(
  dialog: ReturnType<typeof useDialog>,
  title: string,
  field: Extract<FormAnswerField, { type: "string" | "number" | "integer" }>,
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
              const invalid = formValidateValue(field, value)
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
): Promise<FormValue | typeof CANCELLED> {
  const selected = field.default ? [...field.default] : []
  while (true) {
    const invalid = formValidateValue(field, selected)
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
              ...(field.custom ? [{ title: "Type your own answer", value: CUSTOM as typeof CUSTOM }] : []),
              {
                title: "Continue",
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
      const value = await customAnswer(dialog, title, field)
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
): Promise<string | typeof CANCELLED> {
  return new Promise<string | typeof CANCELLED>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt
          title={formLabel(field) || title}
          placeholder="Type your own answer"
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
): Promise<true | typeof CANCELLED> {
  let opened = false
  while (true) {
    const choice = await new Promise<true | typeof OPEN | typeof CANCELLED>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect<true | typeof OPEN>
            title={formLabel(field) || title}
            options={[
              { title: opened ? "Open link again" : "Open link", value: OPEN as typeof OPEN, description: field.url },
              { title: "I finished", value: true as const, description: field.description, disabled: !opened },
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
        () => <OAuthView title={formLabel(field) || title} message="Opening link..." />,
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
  data: ReturnType<typeof useData>,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
  onConnected?: OnIntegrationConnected,
) {
  data.location.integration.invalidate()
  data.location.model.invalidate()
  data.location.provider.invalidate()
  await Promise.all([data.location.integration.sync(), data.location.model.sync(), data.location.provider.sync()])
  toast.show({ variant: "success", message: `Connected ${integration.name}` })
  if (onConnected) {
    onConnected(providerID(data, integration.id))
    return
  }
  dialog.clear()
}

function providerID(data: ReturnType<typeof useData>, integrationID: string) {
  const models = data.location.model.list() ?? []
  const matches = (data.location.provider.list() ?? []).filter(
    (provider) => provider.integrationID === integrationID || provider.id === integrationID,
  )
  return (
    matches.find((provider) =>
      models.some((model) => model.providerID === provider.id && model.status !== "deprecated"),
    )?.id ?? matches[0]?.id
  )
}

async function disconnected(
  name: string,
  data: ReturnType<typeof useData>,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
) {
  data.location.integration.invalidate()
  data.location.model.invalidate()
  data.location.provider.invalidate()
  await Promise.all([data.location.integration.sync(), data.location.model.sync(), data.location.provider.sync()])
  toast.show({ variant: "success", message: `Disconnected ${name}` })
  dialog.clear()
}

function location(data: ReturnType<typeof useData>) {
  const current = data.location.default()
  return { directory: current.directory, workspace: current.workspaceID }
}

function message(cause: unknown) {
  if (cause instanceof Error) return cause.message
  return "Authentication failed"
}
