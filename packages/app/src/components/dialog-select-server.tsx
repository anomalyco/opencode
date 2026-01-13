import { createResource, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { normalizeServerUrl, serverDisplayName, useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useSsh, ConnectionState, type ConnectionProfile, type SshConfigHost } from "@/context/ssh"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { useNavigate } from "@solidjs/router"
import { SshProfileList } from "./ssh-profile-list"
import { DialogSshProfile } from "./dialog-ssh-profile"
import { DialogSshPassword } from "./dialog-ssh-password"
import { showToast, toaster } from "@opencode-ai/ui/toast"

type ServerStatus = { healthy: boolean; version?: string }

async function checkHealth(url: string, fetch?: typeof globalThis.fetch): Promise<ServerStatus> {
  const sdk = createOpencodeClient({
    baseUrl: url,
    fetch,
    signal: AbortSignal.timeout(3000),
  })
  return sdk.global
    .health()
    .then((x) => ({ healthy: x.data?.healthy === true, version: x.data?.version }))
    .catch(() => ({ healthy: false }))
}

export function DialogSelectServer() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const server = useServer()
  const platform = usePlatform()
  const ssh = useSsh()
  const [store, setStore] = createStore({
    url: "",
    adding: false,
    error: "",
    status: {} as Record<string, ServerStatus | undefined>,
  })
  const [defaultUrl, defaultUrlActions] = createResource(() => platform.getDefaultServerUrl?.())
  const isDesktop = platform.platform === "desktop"

  const items = createMemo(() => {
    const current = server.url
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((x) => x !== current)]
  })

  const current = createMemo(() => items().find((x) => x === server.url) ?? items()[0])

  const sortedItems = createMemo(() => {
    const list = items()
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((url, index) => [url, index] as const))
    const rank = (value?: ServerStatus) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff = rank(store.status[a]) - rank(store.status[b])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function refreshHealth() {
    const results: Record<string, ServerStatus> = {}
    await Promise.all(
      items().map(async (url) => {
        results[url] = await checkHealth(url, platform.fetch)
      }),
    )
    setStore("status", reconcile(results))
    
    if (isDesktop) {
      const ssh = useSsh()
      const activeConnectionUrls = new Set<string>()
      for (const conn of ssh.connections()) {
        if (conn.state === "connected" && conn.localEndpoint) {
          const connUrl = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
          activeConnectionUrls.add(connUrl)
        }
      }
      
      const serversToRemove: string[] = []
      for (const url of items()) {
        if (url.startsWith("http://127.0.0.1:") && 
            !activeConnectionUrls.has(url) && 
            results[url]?.healthy === false &&
            url !== server.url) {
          serversToRemove.push(url)
        }
      }
      
      for (const url of serversToRemove) {
        console.log("[Server Dialog] Removing unreachable orphaned server:", url)
        server.remove(url)
      }
    }
  }

  createEffect(() => {
    items()
    refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  function select(value: string, persist?: boolean) {
    if (!persist && store.status[value]?.healthy === false) return
    dialog.close()
    if (persist) {
      server.add(value)
      navigate("/")
      return
    }
    server.setActive(value)
    navigate("/")
  }

  function isSshConnection(input: string): boolean {
    const trimmed = input.trim()
    if (!trimmed) return false
    
    if (/^https?:\/\//.test(trimmed)) return false
    
    const sshPattern = /^([a-zA-Z0-9._-]+@)?[a-zA-Z0-9._-]+(:\d+)?$/
    return sshPattern.test(trimmed)
  }

  function parseSshConnection(input: string): { user?: string; host: string; port?: number } | null {
    const trimmed = input.trim()
    if (!isSshConnection(trimmed)) return null

    const match = trimmed.match(/^([a-zA-Z0-9._-]+@)?([a-zA-Z0-9._-]+)(:(\d+))?$/)
    if (!match) return null

    const user = match[1] ? match[1].slice(0, -1) : undefined
    const host = match[2]
    const port = match[4] ? parseInt(match[4], 10) : undefined

    return { user, host, port }
  }

  async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (typeof window === "undefined" || !("__TAURI__" in window)) {
      throw new Error("Tauri API not available")
    }
    const { invoke } = await import("@tauri-apps/api/core")
    return invoke<T>(cmd, args)
  }

  async function handleSshConnection(input: string) {
    const parsed = parseSshConnection(input)
    if (!parsed) {
      throw new Error("Invalid SSH connection string")
    }

    const configHosts = ssh.configHosts()
    const profiles = ssh.profiles()

    const matchingConfigHost = configHosts.find(
      (h) => h.host === parsed.host && (!parsed.user || h.user === parsed.user) && (!parsed.port || h.port === parsed.port)
    )

    if (matchingConfigHost) {
      const existingProfile = profiles.find(
        (p) => p.host === matchingConfigHost.host && p.name === matchingConfigHost.name
      )

      if (existingProfile) {
        await connectToProfile(existingProfile)
        return
      }

      const profile: ConnectionProfile = {
        id: `ssh-config-${matchingConfigHost.name}`,
        name: matchingConfigHost.name,
        host: matchingConfigHost.host,
        user: matchingConfigHost.user,
        port: matchingConfigHost.port,
        identityFile: matchingConfigHost.identity_file,
        proxyJump: matchingConfigHost.proxy_jump,
        sshConfigMode: "pass-through",
        remoteServerPorts: [],
        remoteHost: "127.0.0.1",
        bootstrapEnabled: true,
        autoReconnect: true,
        createdAt: new Date().toISOString(),
      }

      await ssh.saveProfile(profile)
      await connectToProfile(profile)
      return
    }

    const existingProfile = profiles.find(
      (p) => p.host === parsed.host && (!parsed.user || p.user === parsed.user) && (!parsed.port || p.port === parsed.port)
    )

    if (existingProfile) {
      await connectToProfile(existingProfile)
      return
    }

    const profileName = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host
    const profile: ConnectionProfile = {
      id: `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: profileName,
      host: parsed.host,
      user: parsed.user,
      port: parsed.port,
      sshConfigMode: "pass-through",
      remoteServerPorts: [],
      remoteHost: "127.0.0.1",
      bootstrapEnabled: true,
      autoReconnect: true,
      createdAt: new Date().toISOString(),
    }

    await ssh.saveProfile(profile)
    await connectToProfile(profile)
  }

  async function connectToProfile(profile: ConnectionProfile, password?: string) {
    const connectingToast = showToast({
      title: "Connecting",
      description: `Connecting to ${profile.name}...`,
      persistent: true,
    })

    try {
      const connection = await ssh.connect(profile.id, password)

      if (connection.state === ConnectionState.Connected) {
        toaster.dismiss(connectingToast)
        showToast({
          title: "Connected",
          description: `Successfully connected to ${profile.name}`,
          variant: "success",
        })
        setStore("url", "")
        dialog.close()
      } else {
        toaster.dismiss(connectingToast)
      }
    } catch (error) {
      toaster.dismiss(connectingToast)
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes("SSH_PASSWORD_REQUIRED:")) {
        const sshpassAvailable = await tauriInvoke<boolean>("ssh_check_sshpass_available").catch(() => false)

        if (!sshpassAvailable) {
          setStore("error", "Password authentication requires sshpass. Install sshpass or set up SSH key-based authentication.")
          throw error
        }

        dialog.show(() => (
          <DialogSshPassword
            host={profile.host}
            user={profile.user}
            onConfirm={(pwd) => {
              connectToProfile(profile, pwd)
            }}
            onCancel={() => {
              setStore("adding", false)
            }}
          />
        ))
      } else {
        throw error
      }
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const input = store.url.trim()
    if (!input) return

    setStore("adding", true)
    setStore("error", "")

    if (isSshConnection(input) && isDesktop) {
      try {
        await handleSshConnection(input)
        setStore("adding", false)
        return
      } catch (error) {
        setStore("error", error instanceof Error ? error.message : String(error))
        setStore("adding", false)
        return
      }
    }

    const value = normalizeServerUrl(input)
    if (!value) {
      setStore("error", "Invalid server URL")
      setStore("adding", false)
      return
    }

    const result = await checkHealth(value, platform.fetch)
    setStore("adding", false)

    if (!result.healthy) {
      setStore("error", "Could not connect to server")
      return
    }

    setStore("url", "")
    select(value, true)
  }

  async function handleRemove(url: string) {
    server.remove(url)
  }

  return (
    <Dialog title="Servers" description="Switch which OpenCode server this app connects to.">
      <div class="flex flex-col gap-4 pb-4">
        <List
          search={{ placeholder: "Search servers", autofocus: true }}
          emptyMessage="No servers yet"
          items={sortedItems}
          key={(x) => x}
          current={current()}
          onSelect={(x) => {
            if (x) select(x)
          }}
        >
          {(i) => (
            <div class="flex items-center gap-2 min-w-0 flex-1 group/item">
              <div
                class="flex items-center gap-2 min-w-0 flex-1"
                classList={{ "opacity-50": store.status[i]?.healthy === false }}
              >
                <div
                  classList={{
                    "size-1.5 rounded-full shrink-0": true,
                    "bg-icon-success-base": store.status[i]?.healthy === true,
                    "bg-icon-critical-base": store.status[i]?.healthy === false,
                    "bg-border-weak-base": store.status[i] === undefined,
                  }}
                />
                <span class="truncate">
                  {(() => {
                    const sshAddress = ssh.getProfileAddressForUrl(i)
                    return sshAddress || serverDisplayName(i)
                  })()}
                </span>
                <span class="text-text-weak">{store.status[i]?.version}</span>
              </div>
              <Show when={current() !== i && server.list.includes(i)}>
                <IconButton
                  icon="circle-x"
                  variant="ghost"
                  class="bg-transparent transition-opacity shrink-0 hover:scale-110"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(i)
                  }}
                />
              </Show>
            </div>
          )}
        </List>

        <div class="mt-6 px-3 flex flex-col gap-1.5">
          <div class="px-3">
            <h3 class="text-14-regular text-text-weak">Add a server</h3>
            <Show when={isDesktop}>
              <p class="text-12-regular text-text-weak mt-1">
                Enter an SSH connection (e.g., user@host) or server URL (e.g., http://localhost:4096)
              </p>
            </Show>
          </div>
          <form onSubmit={handleSubmit}>
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0 h-auto">
                <TextField
                  type="text"
                  label="Server URL or SSH connection"
                  hideLabel
                  placeholder={isDesktop ? "user@host or http://localhost:4096" : "http://localhost:4096"}
                  value={store.url}
                  onChange={(v) => {
                    setStore("url", v)
                    setStore("error", "")
                  }}
                  validationState={store.error ? "invalid" : "valid"}
                  error={store.error}
                />
              </div>
              <Button type="submit" variant="secondary" icon="plus-small" size="large" disabled={store.adding}>
                {store.adding ? "Connecting..." : "Add"}
              </Button>
            </div>
          </form>
        </div>

        <Show when={isDesktop}>
          <div class="mt-6 px-3 flex flex-col gap-1.5">
            <div class="px-3">
              <h3 class="text-14-regular text-text-weak">SSH Connections</h3>
            </div>
            <SshProfileList />
          </div>
        </Show>

        <Show when={isDesktop}>
          <div class="mt-6 px-3 flex flex-col gap-1.5">
            <div class="px-3">
              <h3 class="text-14-regular text-text-weak">Default server</h3>
              <p class="text-12-regular text-text-weak mt-1">
                Connect to this server on app launch instead of starting a local server. Requires restart.
              </p>
            </div>
            <div class="flex items-center gap-2 px-3 py-2">
              <Show
                when={defaultUrl()}
                fallback={
                  <Show
                    when={server.url}
                    fallback={<span class="text-14-regular text-text-weak">No server selected</span>}
                  >
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={async () => {
                        await platform.setDefaultServerUrl?.(server.url)
                        defaultUrlActions.refetch(server.url)
                      }}
                    >
                      Set current server as default
                    </Button>
                  </Show>
                }
              >
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="truncate text-14-regular">
                    {(() => {
                      const sshAddress = ssh.getProfileAddressForUrl(defaultUrl()!)
                      return sshAddress || serverDisplayName(defaultUrl()!)
                    })()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={async () => {
                    await platform.setDefaultServerUrl?.(null)
                    defaultUrlActions.refetch()
                  }}
                >
                  Clear
                </Button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
