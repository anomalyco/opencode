import { TextAttributes } from "@opentui/core"
import type {
  ConnectionInfo,
  IntegrationConnectOauthOutput,
  IntegrationInfo,
  IntegrationOAuthMethod,
} from "@opencode-ai/client"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"

const INTEGRATION_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

type ConnectMethod = Exclude<IntegrationInfo["methods"][number], { type: "env" }>
type IntegrationAttempt = IntegrationConnectOauthOutput["data"]
type OnIntegrationConnected = (providerID?: string) => void

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

export function DialogIntegration(props: { onConnected?: OnIntegrationConnected } = {}) {
  const data = useData()
  const dialog = useDialog()
  const { theme } = useTheme()
  const options = createMemo(() =>
    integrationOptions(data.location.integration.list() ?? []).map((integration) => {
      const methods = connectMethods(integration)
      const connected = integration.connections.length > 0
      return {
        title: integration.name,
        value: integration.id,
        description: methods.length ? undefined : "Environment only",
        footer: connectionSummary(integration) || undefined,
        category: integration.id in INTEGRATION_PRIORITY ? "Popular" : "Services",
        disabled: methods.length === 0,
        gutter: connected ? () => <text fg={theme.success}>✓</text> : undefined,
        onSelect: () =>
          credentialConnections(integration).length
            ? manageConnections(integration, methods, dialog, props.onConnected)
            : selectMethod(integration, methods, dialog, props.onConnected),
      }
    }),
  )

  return (
    <DialogSelect
      title="Connect a service"
      options={options()}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>No integrations available</text>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>No integrations found</text>
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
    dialog.replace(() => <KeyMethod integration={integration} method={method} onConnected={onConnected} />)
    return
  }
  void beginOAuth(integration, method, dialog, onConnected)
}

function KeyMethod(props: {
  integration: IntegrationInfo
  method: Extract<ConnectMethod, { type: "key" }>
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const { theme } = useTheme()
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
          })
          .then(() => connected(props.integration, data, dialog, toast, props.onConnected))
          .catch((cause) => setError(message(cause)))
      }}
      description={() => <Show when={error()}>{(value) => <text fg={theme.error}>{value()}</text>}</Show>}
    />
  )
}

async function beginOAuth(
  integration: IntegrationInfo,
  method: IntegrationOAuthMethod,
  dialog: ReturnType<typeof useDialog>,
  onConnected?: OnIntegrationConnected,
) {
  const inputs = method.prompts?.length ? await promptInputs(dialog, method.prompts) : {}
  if (inputs === null) return
  dialog.replace(() => (
    <OAuthStarting integration={integration} method={method} inputs={inputs} onConnected={onConnected} />
  ))
}

function OAuthStarting(props: {
  integration: IntegrationInfo
  method: IntegrationOAuthMethod
  inputs: Record<string, string>
  onConnected?: OnIntegrationConnected
}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()

  onMount(() => {
    void client.api.integration.connect
      .oauth({
        integrationID: props.integration.id,
        location: location(data),
        methodID: props.method.id,
        inputs: props.inputs,
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

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "Copy authorization details",
        group: "Dialog",
        cmd: () => {
          const value = props.attempt.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.attempt.url
          clipboard
            .write?.(value)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  const poll = () => {
    void client.api.integration.attempt
      .status({ attemptID: props.attempt.attemptID, location: location(data) })
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
    void client.api.integration.attempt.cancel({ attemptID: props.attempt.attemptID, location: location(data) })
  })

  return (
    <OAuthView
      title={props.title}
      url={props.attempt.url}
      instructions={props.attempt.instructions}
      message="Waiting for authorization..."
      copy
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
  const { theme } = useTheme()
  const [error, setError] = createSignal<string>()
  let settled = false

  onCleanup(() => {
    if (settled) return
    void client.api.integration.attempt.cancel({ attemptID: props.attempt.attemptID, location: location(data) })
  })

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={(code) => {
        if (!code) return
        void client.api.integration.attempt
          .complete({ attemptID: props.attempt.attemptID, location: location(data), code })
          .then(() => {
            settled = true
            return connected(props.integration, data, dialog, toast, props.onConnected)
          })
          .catch((cause) => setError(message(cause)))
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.attempt.instructions}</text>
          <Link href={props.attempt.url} fg={theme.primary} />
          <Show when={error()}>{(value) => <text fg={theme.error}>{value()}</text>}</Show>
        </box>
      )}
    />
  )
}

function OAuthView(props: { title: string; url?: string; instructions?: string; message: string; copy?: boolean }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={props.url}>
        {(url) => (
          <box gap={1}>
            <Link href={url()} fg={theme.primary} />
            <Show when={props.instructions}>
              {(instructions) => <text fg={theme.textMuted}>{instructions()}</text>}
            </Show>
          </box>
        )}
      </Show>
      <text fg={theme.textMuted}>{props.message}</text>
      <Show when={props.copy}>
        <text fg={theme.text}>
          c <span style={{ fg: theme.textMuted }}>copy</span>
        </text>
      </Show>
    </box>
  )
}

async function promptInputs(
  dialog: ReturnType<typeof useDialog>,
  prompts: NonNullable<IntegrationOAuthMethod["prompts"]>,
) {
  const inputs: Record<string, string> = {}
  for (const prompt of prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }
    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((option) => ({
                title: option.label,
                value: option.value,
                description: option.hint,
              }))}
              onSelect={(option) => resolve(option.value)}
            />
          ),
          () => resolve(null),
        )
      })
      if (value === null) return null
      inputs[prompt.key] = value
      continue
    }
    const value = await new Promise<string | null>((resolve) => {
      dialog.replace(
        () => <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={resolve} />,
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}

async function connected(
  integration: IntegrationInfo,
  data: ReturnType<typeof useData>,
  dialog: ReturnType<typeof useDialog>,
  toast: ReturnType<typeof useToast>,
  onConnected?: OnIntegrationConnected,
) {
  await Promise.all([
    data.location.integration.refresh(),
    data.location.model.refresh(),
    data.location.provider.refresh(),
  ])
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
  await Promise.all([
    data.location.integration.refresh(),
    data.location.model.refresh(),
    data.location.provider.refresh(),
  ])
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
