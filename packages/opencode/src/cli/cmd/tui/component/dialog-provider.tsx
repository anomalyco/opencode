import { createMemo, createSignal, onMount, Show, createEffect } from "solid-js"
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
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { parseDatabricksProfiles, pickDatabricksProfileFlow } from "@/provider/databricks-profile"
import os from "os"
import path from "path"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
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
          openai: "(ChatGPT Plus/Pro or API key)",
          "opencode-go": "Low cost subscription for everyone",
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
            // Databricks requires both host and API key
            if (provider.id === "databricks") {
              return dialog.replace(() => <DatabricksApiMethod providerID={provider.id} title={method.label} />)
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
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

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

interface DatabricksApiMethodProps {
  providerID: string
  title: string
}
function DatabricksApiMethod(props: DatabricksApiMethodProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const [profileOptions, setProfileOptions] = createSignal<string[]>([])
  const [showHostPrompt, setShowHostPrompt] = createSignal(false)
  const [profileHint, setProfileHint] = createSignal<string | undefined>()
  const [pendingProfile, setPendingProfile] = createSignal<string | undefined>()
  // Get host from environment variable
  const envHost = typeof process !== "undefined" ? process.env["DATABRICKS_HOST"] : undefined

  const readProfiles = async () => {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? os.homedir()
    const raw = process.env["DATABRICKS_CONFIG_FILE"] ?? path.join(home, ".databrickscfg")
    const cfg = raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw
    try {
      const file = Bun.file(cfg)
      if (!(await file.exists())) return []
      const profiles = parseDatabricksProfiles(await file.text())
      if (profiles.length > 0) return profiles
    } catch {
      // ignore and try CLI fallback
    }
    try {
      const proc = Bun.spawn(["databricks", "auth", "profiles"], {
        stdout: "pipe",
        stderr: "ignore",
      })
      const output = await new Response(proc.stdout).text()
      if ((await proc.exited) !== 0) return []
      return output
        .split("\n")
        .map((line) => line.trim())
        .flatMap((line) => {
          if (!line || line.startsWith("Name")) return []
          const match = line.match(/^(.+?)\s{2,}/)
          if (!match) return []
          const name = match[1]?.trim()
          if (!name) return []
          return [name]
        })
    } catch {
      return []
    }
  }

  const authWithSdk = async (profile?: string) => {
    try {
      const { Config: DatabricksConfig } = await import("@databricks/sdk-experimental")
      const dbConfig = new DatabricksConfig({
        env: process.env,
        profile,
      })
      await dbConfig.ensureResolved()
      if (!dbConfig.host) return false
      const headers = new Headers()
      await dbConfig.authenticate(headers)
      return headers.has("Authorization")
    } catch {
      return false
    }
  }

  const connect = async () => {
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  }

  // Check if the Databricks SDK can authenticate (CLI tokens, databrickscfg, etc.)
  onMount(async () => {
    const envProfile = process.env["DATABRICKS_CONFIG_PROFILE"]?.trim()
    if (envProfile) setProfileHint(envProfile)
    if (envProfile && (await authWithSdk(envProfile))) return connect()

    const profiles = await readProfiles()
    const flow = pickDatabricksProfileFlow({ profiles })
    if (flow.promptProfiles) setProfileOptions(flow.promptProfiles)
    if (flow.promptProfiles) return
    if (await authWithSdk()) return connect()
  })

  createEffect(() => {
    const profile = pendingProfile()
    if (!profile) return
    void (async () => {
      if (await authWithSdk(profile)) return connect()
      setPendingProfile(undefined)
      setShowHostPrompt(true)
    })()
  })

  if (pendingProfile()) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Authenticating Databricks profile
        </text>
        <text fg={theme.textMuted}>Profile: {pendingProfile()}</text>
        <text fg={theme.textMuted}>Checking Databricks CLI credentials...</text>
      </box>
    )
  }

  if (profileOptions().length > 0) {
    return (
      <DialogSelect
        title="Select Databricks profile"
        options={profileOptions().map((profile) => ({
          title: profile,
          value: profile,
        }))}
        onSelect={async (option) => {
          const profile = option.value
          const updated = await sdk.client.auth
            .set(
              {
                providerID: props.providerID,
                auth: {
                  type: "databricks-profile",
                  profile,
                },
              },
              { throwOnError: true },
            )
            .then(() => true)
            .catch(() => false)
          if (!updated) {
            setShowHostPrompt(true)
            return
          }
          setPendingProfile(profile)
        }}
      />
    )
  }

  if (!showHostPrompt()) {
    return (
      <DialogPrompt
        title="Databricks Profile"
        placeholder={profileHint() ?? "DEFAULT"}
        description={() => (
          <box gap={1}>
            <text fg={theme.textMuted}>Enter the Databricks CLI profile to use</text>
            <text fg={theme.textMuted}>Run "databricks auth profiles" to list available profiles</text>
          </box>
        )}
        onConfirm={async (value) => {
          const profile = value?.trim()
          if (!profile) return
          const updated = await sdk.client.auth
            .set(
              {
                providerID: props.providerID,
                auth: {
                  type: "databricks-profile",
                  profile,
                },
              },
              { throwOnError: true },
            )
            .then(() => true)
            .catch(() => false)
          if (!updated) {
            setShowHostPrompt(true)
            return
          }
          setPendingProfile(profile)
        }}
      />
    )
  }

  return (
    <DialogPrompt
      title="Databricks Host URL"
      placeholder="https://your-workspace.cloud.databricks.com"
      value={envHost ? envHost.replace(/\/$/, "") : undefined}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>Enter your Databricks workspace URL</text>
          <text fg={theme.textMuted}>Examples:</text>
          <text fg={theme.textMuted}> • https://dbc-xxx.cloud.databricks.com (AWS/GCP)</text>
          <text fg={theme.textMuted}> • https://adb-xxx.azuredatabricks.net (Azure)</text>
        </box>
      )}
      onConfirm={(value) => {
        if (!value) return
        // Remove trailing slash if present
        const cleanHost = value.replace(/\/$/, "")
        dialog.replace(() => (
          <DatabricksApiKeyMethod providerID={props.providerID} title={props.title} host={cleanHost} />
        ))
      }}
    />
  )
}

interface DatabricksApiKeyMethodProps {
  providerID: string
  title: string
  host: string
}
function DatabricksApiKeyMethod(props: DatabricksApiKeyMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key (Personal Access Token)"
      description={
        <box gap={1}>
          <text fg={theme.textMuted}>Enter your Databricks Personal Access Token</text>
          <text fg={theme.textMuted}>Create at: Workspace → Settings → Developer → Access tokens</text>
        </box>
      }
      onConfirm={async (value) => {
        if (!value) return
        sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
            host: props.host,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
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
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
