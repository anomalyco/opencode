import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2"
import { DialogModel } from "./dialog-model"
import { DialogCredentials } from "./dialog-credentials"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  openrouter: 5,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()

  const oauthCounts = createMemo(() => {
    const counts = new Map<string, number>()
    for (const c of sync.data.credential) {
      if (c.kind !== "oauth") continue
      counts.set(c.providerId, (counts.get(c.providerId) ?? 0) + 1)
    }
    return counts
  })

  const options = createMemo(() => {
    const counts = oauthCounts()
    const providerOptions = pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: (() => {
          const base =
            {
              opencode: "(Recommended)",
              anthropic: "(Claude Max or API key)",
            }[provider.id] ?? ""
          const n = counts.get(provider.id) ?? 0
          const suffix = n > 0 ? ` (${n} account${n === 1 ? "" : "s"})` : ""
          return `${base}${suffix}`.trim() || undefined
        })(),
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const rawNamespace = await DialogPrompt.show(dialog, "Namespace (optional)", {
              placeholder: "default",
              description: () => (
                <box gap={1}>
                  <text fg={theme.textMuted}>Leave blank to use the default namespace.</text>
                </box>
              ),
            })
            if (rawNamespace === null) return
            const namespace = rawNamespace.split("\n")[0]?.trim() || undefined

            const rawLabel = await DialogPrompt.show(dialog, "Account label (optional)", {
              placeholder: "default",
              description: () => (
                <box gap={1}>
                  <text fg={theme.textMuted}>Leave blank to auto-generate.</text>
                </box>
              ),
            })
            if (rawLabel === null) return
            const label = rawLabel.split("\n")[0]?.trim() || undefined

            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
              namespace,
              label,
            })
            if (result.data?.method === "code") {
              dialog.replace(() => (
                <CodeMethod
                  providerID={provider.id}
                  title={method.label}
                  index={index}
                  authorization={result.data!}
                  namespace={namespace}
                  label={label}
                />
              ))
            }
            if (result.data?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod
                  providerID={provider.id}
                  title={method.label}
                  index={index}
                  authorization={result.data!}
                  namespace={namespace}
                  label={label}
                />
              ))
            }
          }
          if (method.type === "api") {
            dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
    )

    return [
      {
        title: "Manage connected accounts",
        value: "__manage__",
        description: "View, rename, or remove stored credentials",
        category: "Manage",
        async onSelect() {
          dialog.replace(() => <DialogCredentials />)
        },
      },
      ...providerOptions,
    ]
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
  namespace?: string
  label?: string
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
      namespace: props.namespace,
      label: props.label,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <text fg={theme.primary}>{props.authorization.url}</text>
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
  namespace?: string
  label?: string
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
          namespace: props.namespace,
          label: props.label,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <text fg={theme.primary}>{props.authorization.url}</text>
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "opencode" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>
              OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API key.
            </text>
            <text fg={theme.text}>
              Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
            </text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
