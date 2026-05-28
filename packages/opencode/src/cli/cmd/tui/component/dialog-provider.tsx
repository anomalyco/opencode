import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogConfirm } from "../ui/dialog-confirm"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@opencode-ai/sdk/v2"
import { DialogModel } from "./dialog-model"
import * as Clipboard from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { isConsoleManagedProvider } from "@tui/util/provider-origin"
import { useConnected } from "./use-connected"
import { useBindings } from "../keymap"
import { type CustomProviderForm, validateCustomProvider } from "./dialog-custom-provider-form"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

const CUSTOM_PROVIDER_OPTION_VALUE = "__opencode_custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

type ProviderOptionBase = {
  title: string
  value: string
  description?: string
  category: string
}

type ProviderOption =
  | (ProviderOptionBase & {
      type: "provider"
      providerID: string
    })
  | (ProviderOptionBase & {
      type: "custom"
    })

export function providerOptions(list: { id: string; name: string }[]): ProviderOption[] {
  return [
    ...pipe(
      list,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        type: "provider" as const,
        title: provider.name,
        value: provider.id,
        providerID: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
          "opencode-go": "Low cost subscription for everyone",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Providers",
      })),
    ),
    {
      type: "custom",
      title: "Custom provider",
      value: CUSTOM_PROVIDER_OPTION_VALUE,
      description: "OpenAI-compatible endpoint",
      category: "Providers",
    },
  ]
}

export function normalizeCustomProviderID(value: string) {
  const providerID = value.trim().replace(/^@ai-sdk\//, "")
  if (!CUSTOM_PROVIDER_ID.test(providerID)) return
  return providerID
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const onboarded = useConnected()
  const options = createMemo(() => {
    return pipe(
      providerOptions(sync.data.provider_next.all),
      map((provider) => {
        if (provider.type === "custom") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              await CustomProviderMethod({ dialog, sdk, sync, toast })
            },
          }
        }

        const providerID = provider.providerID
        const consoleManaged = isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerID)
        const connected = sync.data.provider_next.connected.includes(providerID)

        return {
          title: provider.title,
          value: provider.value,
          description: provider.description,
          footer: consoleManaged ? sync.data.console_state.activeOrgName : undefined,
          category: provider.category,
          gutter: connected && onboarded() ? () => <text fg={theme.success}>✓</text> : undefined,
          async onSelect() {
            if (consoleManaged) return

            const methods = sync.data.provider_auth[providerID] ?? [
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
              let inputs: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({
                  dialog,
                  prompts: method.prompts,
                })
                if (!value) return
                inputs = value
              }

              const result = await sdk.client.provider.oauth.authorize({
                providerID,
                method: index,
                inputs,
              })
              if (result.error) {
                toast.show({
                  variant: "error",
                  message: JSON.stringify(result.error),
                })
                dialog.clear()
                return
              }
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
            }
            if (method.type === "api") {
              let metadata: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({ dialog, prompts: method.prompts })
                if (!value) return
                metadata = value
              }
              return dialog.replace(() => <ApiMethod providerID={providerID} title={method.label} metadata={metadata} />)
            }
          },
        }
      }),
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
  const toast = useToast()

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "Copy provider code",
        group: "Dialog",
        cmd: () => {
          const code =
            props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
          Clipboard.copy(code)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      toast.show({
        variant: "error",
        message:
          "name" in result.error && result.error.name === "ProviderAuthOauthCallbackFailed"
            ? "OAuth authorization failed. Try /connect again."
            : JSON.stringify(result.error),
      })
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
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
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
  metadata?: Record<string, string>
  custom?: boolean
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        {
          opencode: (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API
                key.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
              </text>
            </box>
          ),
          "opencode-go": (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Go is a $10 per month subscription that provides reliable access to popular open coding models
                with generous usage limits.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> and enable OpenCode Go
              </text>
            </box>
          ),
        }[props.providerID] ?? undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
            ...(props.metadata ? { metadata: props.metadata } : {}),
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        if (props.custom && !sync.data.provider_next.all.some((provider) => provider.id === props.providerID)) {
          toast.show({
            variant: "info",
            message: `Saved credential for ${props.providerID}. Configure it in opencode.json to use it.`,
          })
          dialog.clear()
          return
        }
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

async function CustomProviderMethod(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
}) {
  const prompt = (args: {
    title: string
    placeholder?: string
    value?: string
    validate?: (value: string) => string | undefined
  }) => promptCustomProviderValue({ ...args, dialog: input.dialog, toast: input.toast })

  const providerID = await prompt({
    title: "Provider ID",
    placeholder: "myprovider",
    validate(value) {
      if (!value.trim()) return "Provider ID is required"
      if (!/^[a-z0-9][a-z0-9-_]*$/.test(value.trim())) {
        return "Use lowercase letters, numbers, hyphens, and underscores"
      }
      const disabled = input.sync.data.config.disabled_providers ?? []
      if (
        input.sync.data.provider_next.all.some((provider) => provider.id === value.trim()) &&
        !disabled.includes(value.trim())
      ) {
        return "Provider ID already exists"
      }
      return undefined
    },
  })
  if (providerID === null) return

  const name = await prompt({
    title: "Display name",
    placeholder: "My AI Provider",
    value: providerID,
    validate: (value) => (value.trim() ? undefined : "Display name is required"),
  })
  if (name === null) return

  const baseURL = await prompt({
    title: "Base URL",
    placeholder: "https://api.myprovider.com/v1",
    validate(value) {
      if (!value.trim()) return "Base URL is required"
      if (!/^https?:\/\//.test(value.trim())) return "Base URL must start with http:// or https://"
      return undefined
    },
  })
  if (baseURL === null) return

  const apiKey = await prompt({
    title: "API key",
    placeholder: "Leave empty to skip, or use {env: PROVIDER_API_KEY}",
  })
  if (apiKey === null) return

  const models: CustomProviderForm["models"] = []
  while (true) {
    const id = await prompt({
      title: models.length === 0 ? "Model ID" : "Additional model ID",
      placeholder: "model-id",
      validate(value) {
        const id = value.trim()
        if (!id) return "Model ID is required"
        if (models.some((model) => model.id.trim() === id)) return "Model ID already exists"
        return undefined
      },
    })
    if (id === null) return

    const modelName = await prompt({
      title: "Model name",
      placeholder: "Display name",
      value: id,
      validate: (value) => (value.trim() ? undefined : "Model name is required"),
    })
    if (modelName === null) return
    models.push({ id, name: modelName })

    const more = await DialogConfirm.show(
      input.dialog,
      "Add another model?",
      "Configure another model for this custom provider.",
      "done",
    )
    if (more === undefined) return
    if (!more) break
  }

  const headers: CustomProviderForm["headers"] = []
  let addHeader = await DialogConfirm.show(
    input.dialog,
    "Add custom header?",
    "Add optional headers to every request for this provider.",
    "skip",
  )
  if (addHeader === undefined) return
  while (addHeader) {
    const key = await prompt({
      title: "Header name",
      placeholder: "Header-Name",
      validate(value) {
        const key = value.trim()
        if (!key) return "Header name is required"
        if (headers.some((header) => header.key.trim().toLowerCase() === key.toLowerCase())) {
          return "Header already exists"
        }
        return undefined
      },
    })
    if (key === null) return

    const value = await prompt({
      title: "Header value",
      placeholder: "value",
      validate: (value) => (value.trim() ? undefined : "Header value is required"),
    })
    if (value === null) return
    headers.push({ key, value })

    addHeader = await DialogConfirm.show(
      input.dialog,
      "Add another header?",
      "Configure another custom header for this provider.",
      "done",
    )
    if (addHeader === undefined) return
  }

  const result = validateCustomProvider({
    form: {
      providerID,
      name,
      baseURL,
      apiKey,
      models,
      headers,
    },
    disabledProviders: input.sync.data.config.disabled_providers ?? [],
    existingProviderIDs: new Set(input.sync.data.provider_next.all.map((provider) => provider.id)),
  })

  if (!result.ok) {
    input.toast.show({ variant: "error", message: result.error })
    return
  }

  input.dialog.replace(() => <DialogPrompt title="Saving custom provider" busy busyText="Updating configuration..." />)

  try {
    if (result.key) {
      await input.sdk.client.auth.set({
        providerID: result.providerID,
        auth: {
          type: "api",
          key: result.key,
        },
      })
    }

    const disabledProviders = input.sync.data.config.disabled_providers ?? []
    await input.sdk.client.global.config.update({
      config: {
        provider: { [result.providerID]: result.config },
        disabled_providers: disabledProviders.filter((id) => id !== result.providerID),
      },
    })
    await input.sync.bootstrap()
    input.toast.show({ variant: "success", message: `${result.name} connected` })
    input.dialog.replace(() => <DialogModel providerID={result.providerID} />)
  } catch (err) {
    input.dialog.clear()
    input.toast.show({
      variant: "error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function promptCustomProviderValue(input: {
  dialog: ReturnType<typeof useDialog>
  toast: ReturnType<typeof useToast>
  title: string
  placeholder?: string
  value?: string
  validate?: (value: string) => string | undefined
}) {
  let current = input.value
  while (true) {
    const value = await DialogPrompt.show(input.dialog, input.title, {
      placeholder: input.placeholder,
      value: current,
    })
    if (value === null) return null

    const error = input.validate?.(value)
    if (!error) return value

    current = value
    input.toast.show({ variant: "error", message: error })
  }
}

interface PromptsMethodProps {
  dialog: ReturnType<typeof useDialog>
  prompts: NonNullable<ProviderAuthMethod["prompts"]>[number][]
}
async function PromptsMethod(props: PromptsMethodProps) {
  const inputs: Record<string, string> = {}
  for (const prompt of props.prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }

    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        props.dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((x) => ({
                title: x.label,
                value: x.value,
                description: x.hint,
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
      props.dialog.replace(
        () => (
          <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(value) => resolve(value)} />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}
