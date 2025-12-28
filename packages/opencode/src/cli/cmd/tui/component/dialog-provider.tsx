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

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  "google-vertex": 5,
  "google-vertex-anthropic": 6,
  openrouter: 7,
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  "google-vertex": "Google Vertex AI",
  "google-vertex-anthropic": "Google Vertex AI (Anthropic)",
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
        title: PROVIDER_DISPLAY_NAMES[provider.id] ?? provider.name,
        value: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(Claude Max or API key)",
          "google-vertex": "(Service Account)",
          "google-vertex-anthropic": "(Service Account)",
        }[provider.id],
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
            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
            })
            if (result.data?.method === "code") {
              dialog.replace(() => (
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
            if (result.data?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
          }
          if (method.type === "api") {
            // Use ServiceAccountMethod for Vertex AI providers
            if (provider.id === "google-vertex" || provider.id === "google-vertex-anthropic") {
              return dialog.replace(() => <ServiceAccountMethod providerID={provider.id} />)
            }
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
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

interface ServiceAccountMethodProps {
  providerID: string
}
function ServiceAccountMethod(props: ServiceAccountMethodProps) {
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  return <ServiceAccountPasteInput providerID={props.providerID} />
}

function ServiceAccountPasteInput(props: { providerID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")
  let textareaRef: any

  const providerDisplayName = () =>
    props.providerID === "google-vertex-anthropic" ? "Google Vertex AI (Anthropic)" : "Google Vertex AI"

  const validateJson = (content: string): { valid: boolean; json?: any; error?: string } => {
    try {
      const json = JSON.parse(content)
      if (json.type !== "service_account") {
        return { valid: false, error: "Invalid: 'type' must be 'service_account'" }
      }
      if (!json.client_email) {
        return { valid: false, error: "Invalid: missing 'client_email' field" }
      }
      if (!json.private_key) {
        return { valid: false, error: "Invalid: missing 'private_key' field" }
      }
      if (!json.project_id) {
        return { valid: false, error: "Invalid: missing 'project_id' field" }
      }
      return { valid: true, json }
    } catch (e) {
      return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : "parse error"}` }
    }
  }

  const handleSubmit = () => {
    const content = textareaRef?.plainText || ""
    setError("")

    if (!content || !content.trim()) {
      setError("Required - paste your service account JSON")
      return
    }

    const result = validateJson(content)
    if (!result.valid) {
      setError(result.error!)
      return
    }

    dialog.replace(() => (
      <ServiceAccountLocationInput
        providerID={props.providerID}
        serviceAccountJson={content}
      />
    ))
  }

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {providerDisplayName()}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>Paste your service account JSON below and press Ctrl+S to submit.</text>
          <text fg={theme.text}>
            Download from{" "}
            <span style={{ fg: theme.primary }}>https://console.cloud.google.com/iam-admin/serviceaccounts</span>
          </text>
        </box>
      </box>
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <textarea
          ref={(r: any) => {
            textareaRef = r
            setTimeout(() => r.focus(), 1)
          }}
          height={15}
          placeholder='{"type": "service_account", ...}'
          backgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          keyBindings={[{ name: "return", action: "submit" }]}
          onSubmit={handleSubmit}
        />
      </box>
      <box paddingLeft={4} paddingRight={4}>
        <text fg={theme.textMuted}>Paste JSON and press Enter to submit</text>
        <Show when={error()}>
          <text fg={theme.error}>{error()}</text>
        </Show>
      </box>
    </box>
  )
}

function ServiceAccountLocationInput(props: { providerID: string; serviceAccountJson: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")

  const defaultLocation = () => (props.providerID === "google-vertex-anthropic" ? "global" : "us-east5")

  const handleLocationSubmit = async (location: string) => {
    try {
      const json = JSON.parse(props.serviceAccountJson)
      const finalLocation = location || defaultLocation()

      sdk.client.auth.set({
        providerID: props.providerID,
        auth: {
          type: "api",
          key: JSON.stringify({
            client_email: json.client_email,
            private_key: json.private_key,
            project_id: json.project_id,
            location: finalLocation,
          }),
        },
      })
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      dialog.replace(() => <DialogModel providerID={props.providerID} />)
    } catch (e) {
      setError(`Failed to save credentials: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }

  return (
    <DialogPrompt
      title="Location"
      placeholder={defaultLocation()}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Enter the Vertex AI location (region).</text>
          <text fg={theme.text}>
            Press enter to use default: <span style={{ fg: theme.primary }}>{defaultLocation()}</span>
          </text>
          <Show when={error()}>
            <text fg={theme.error}>{error()}</text>
          </Show>
        </box>
      )}
      onConfirm={handleLocationSubmit}
    />
  )
}
