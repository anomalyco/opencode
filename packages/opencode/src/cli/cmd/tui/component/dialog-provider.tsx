import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2"
import { DialogModel } from "./dialog-model"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  openrouter: 5,
}

interface AccountInfo {
  name: string
  type: "oauth" | "api" | "wellknown"
  active: boolean
}

function DialogAccounts(props: { providerID: string; providerName: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const [accounts, setAccounts] = createSignal<AccountInfo[]>([])

  onMount(async () => {
    const result = await sdk.client.auth.accounts.list({ providerID: props.providerID })
    if (result.data) setAccounts(result.data)
  })

  const options = createMemo(() => {
    const accountOptions = accounts().map((account) => ({
      title: account.name,
      value: account.name,
      description: account.active ? "(Active)" : undefined,
      async onSelect() {
        if (account.active) {
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        await sdk.client.auth.accounts.setActive({
          providerID: props.providerID,
          accountName: account.name,
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      },
    }))

    return [
      ...accountOptions,
      {
        title: "+ Add account",
        value: "__add__",
        async onSelect() {
          dialog.replace(() => <DialogAccountName providerID={props.providerID} providerName={props.providerName} />)
        },
      },
    ]
  })

  return <DialogSelect title={`${props.providerName} accounts`} options={options()} />
}

function DialogAccountName(props: { providerID: string; providerName: string }) {
  const dialog = useDialog()

  return (
    <DialogPrompt
      title="Account name"
      placeholder="e.g. personal, work"
      onConfirm={async (value) => {
        const accountName = value?.trim() || "default"
        dialog.replace(() => (
          <DialogAuthMethod providerID={props.providerID} providerName={props.providerName} accountName={accountName} />
        ))
      }}
    />
  )
}

function DialogAuthMethod(props: { providerID: string; providerName: string; accountName: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()

  const methods = createMemo(() => {
    return sync.data.provider_auth[props.providerID] ?? [{ type: "api", label: "API key" }]
  })

  onMount(async () => {
    const m = methods()
    if (m.length === 1) {
      await startAuth(0, m[0])
    }
  })

  async function startAuth(index: number, method: { type: string; label: string }) {
    if (method.type === "oauth") {
      const result = await sdk.client.provider.oauth.authorize({
        providerID: props.providerID,
        method: index,
        accountName: props.accountName,
      })
      if (result.data?.method === "code") {
        dialog.replace(() => (
          <CodeMethod
            providerID={props.providerID}
            title={method.label}
            index={index}
            authorization={result.data!}
            accountName={props.accountName}
          />
        ))
      }
      if (result.data?.method === "auto") {
        dialog.replace(() => (
          <AutoMethod
            providerID={props.providerID}
            title={method.label}
            index={index}
            authorization={result.data!}
            accountName={props.accountName}
          />
        ))
      }
    }
    if (method.type === "api") {
      dialog.replace(() => (
        <ApiMethod providerID={props.providerID} title={method.label} accountName={props.accountName} />
      ))
    }
  }

  const options = createMemo(() =>
    methods().map((method, index) => ({
      title: method.label,
      value: index,
      async onSelect() {
        await startAuth(index, method)
      },
    })),
  )

  return (
    <Show when={methods().length > 1} fallback={null}>
      <DialogSelect title="Select auth method" options={options()} />
    </Show>
  )
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(Claude Max or API key)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          const accountsResult = await sdk.client.auth.accounts.list({ providerID: provider.id })
          const accounts = accountsResult.data ?? []

          if (accounts.length > 0) {
            dialog.replace(() => <DialogAccounts providerID={provider.id} providerName={provider.name} />)
            return
          }

          dialog.replace(() => <DialogAccountName providerID={provider.id} providerName={provider.name} />)
        },
      })),
    )
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
  accountName: string
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
      accountName: props.accountName,
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
        <Link href={props.authorization.url} fg={theme.primary} />
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
  accountName: string
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
          accountName: props.accountName,
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
          <Link href={props.authorization.url} fg={theme.primary} />
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
  accountName: string
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
        await sdk.client.auth.accounts.set({
          providerID: props.providerID,
          accountName: props.accountName,
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
