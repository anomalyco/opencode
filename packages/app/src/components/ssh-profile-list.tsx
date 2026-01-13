import { Component, For, Show, createMemo } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSsh, ConnectionState, type ConnectionProfile, type SshConfigHost } from "@/context/ssh"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DialogSshProfile } from "./dialog-ssh-profile"
import { DialogSshPassword } from "./dialog-ssh-password"
import { showToast, toaster } from "@opencode-ai/ui/toast"

export const SshProfileList: Component = () => {
  const dialog = useDialog()
  const ssh = useSsh()

  const profiles = createMemo(() => ssh.profiles())
  const configHosts = createMemo(() => ssh.configHosts())
  const connections = createMemo(() => ssh.connections())

  const getConnectionState = (profileId: string): ConnectionState | null => {
    const conns = connections()
    console.log("[SSH UI] getConnectionState called for", profileId, "connections:", conns, "count:", conns.length)
    const matchingConnections = conns.filter((c) => c.profileId === profileId)
    console.log("[SSH UI] Matching connections for", profileId, ":", matchingConnections.map(c => ({ id: c.id, state: c.state })))
    const connection = matchingConnections.find((c) => c.state === ConnectionState.Connected) || matchingConnections[matchingConnections.length - 1]
    console.log("[SSH UI] Selected connection:", connection, "state:", connection?.state)
    return connection?.state ?? null
  }

  const getConnection = (profileId: string) => {
    return connections().find((c) => c.profileId === profileId)
  }

  const handleConnect = async (profile: ConnectionProfile, password?: string) => {
    console.log("[SSH UI] handleConnect called for profile:", profile.id, profile.name, "withPassword:", !!password)
    
    const connectingToast = showToast({ 
      title: "Connecting", 
      description: `Connecting to ${profile.name}...`,
      persistent: true,
    })
    
    try {
      console.log("[SSH UI] Calling ssh.connect for profile:", profile.id)
      const connection = await ssh.connect(profile.id, password)
      console.log("[SSH UI] Connection result:", connection.id, "state:", connection.state)
      
      if (connection.state === ConnectionState.Connected) {
        toaster.dismiss(connectingToast)
        showToast({ 
          title: "Connected", 
          description: `Successfully connected to ${profile.name}`,
          variant: "success",
        })
      } else {
        console.log("[SSH UI] Connection not yet connected, state:", connection.state)
        toaster.dismiss(connectingToast)
      }
    } catch (error) {
      console.error("[SSH UI] Connection error:", error)
      toaster.dismiss(connectingToast)
      
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (errorMessage.includes("SSH_PASSWORD_REQUIRED:")) {
        const sshpassAvailable = await tauriInvoke<boolean>("ssh_check_sshpass_available").catch(() => false)
        
        if (!sshpassAvailable) {
          showToast({
            title: "Password authentication requires sshpass",
            description: "Install sshpass to use password authentication, or set up SSH key-based authentication instead.",
            variant: "error",
          })
          return
        }
        
        dialog.show(() => (
          <DialogSshPassword
            host={profile.host}
            user={profile.user}
            onConfirm={(pwd) => {
              handleConnect(profile, pwd)
            }}
            onCancel={() => {
            }}
          />
        ))
      } else {
        showToast({
          title: "Connection failed",
          description: errorMessage,
          variant: "error",
        })
      }
    }
  }
  
  async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (typeof window === "undefined" || !("__TAURI__" in window)) {
      throw new Error("Tauri API not available")
    }
    const { invoke } = await import("@tauri-apps/api/core")
    return invoke<T>(cmd, args)
  }

  const handleDisconnect = async (profile: ConnectionProfile) => {
    const connection = getConnection(profile.id)
    if (connection) {
      try {
        await ssh.disconnect(connection.id)
        showToast({ title: "Disconnected", description: `Disconnected from ${profile.name}` })
      } catch (error) {
        showToast({
          title: "Disconnect failed",
          description: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
      }
    }
  }

  const handleEdit = (profile: ConnectionProfile) => {
    dialog.show(() => <DialogSshProfile profile={profile} />)
  }

  const handleSelectSshHost = async (hostString: string, configHost?: SshConfigHost) => {
    try {
      if (configHost) {
        const existingProfile = profiles().find((p) => p.host === configHost.host && p.name === configHost.name)
        if (existingProfile) {
          const connectingToast = showToast({ 
            title: "Connecting", 
            description: `Connecting to ${configHost.name}...`,
            persistent: true,
          })
          try {
            const connection = await ssh.connect(existingProfile.id)
            if (connection.state === ConnectionState.Connected) {
              toaster.dismiss(connectingToast)
              showToast({ 
                title: "Connected", 
                description: `Successfully connected to ${configHost.name}`,
                variant: "success",
              })
            } else {
              toaster.dismiss(connectingToast)
            }
          } catch (error) {
            toaster.dismiss(connectingToast)
            const errorMessage = error instanceof Error ? error.message : String(error)
            if (errorMessage.includes("SSH_PASSWORD_REQUIRED:")) {
              const sshpassAvailable = await tauriInvoke<boolean>("ssh_check_sshpass_available").catch(() => false)
              if (sshpassAvailable) {
                dialog.show(() => (
                  <DialogSshPassword
                    host={existingProfile.host}
                    user={existingProfile.user}
                    onConfirm={(pwd) => {
                      handleConnect(existingProfile, pwd)
                    }}
                    onCancel={() => {}}
                  />
                ))
                return
              }
            }
            throw error
          }
          return
        }

        const profile: ConnectionProfile = {
          id: `ssh-config-${configHost.name}`,
          name: configHost.name,
          host: configHost.host,
          user: configHost.user,
          port: configHost.port,
          identityFile: configHost.identity_file,
          proxyJump: configHost.proxy_jump,
          sshConfigMode: "pass-through",
          remoteServerPorts: [],
          remoteHost: "127.0.0.1",
          bootstrapEnabled: true,
          autoReconnect: true,
          createdAt: new Date().toISOString(),
        }

        await ssh.saveProfile(profile)
        const connectingToast = showToast({ 
          title: "Connecting", 
          description: `Connecting to ${configHost.name}...`,
          persistent: true,
        })
        try {
          const connection = await ssh.connect(profile.id)
          if (connection.state === ConnectionState.Connected) {
            toaster.dismiss(connectingToast)
            showToast({ 
              title: "Connected", 
              description: `Successfully connected to ${configHost.name}`,
              variant: "success",
            })
          } else {
            toaster.dismiss(connectingToast)
          }
        } catch (error) {
          toaster.dismiss(connectingToast)
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (errorMessage.includes("SSH_PASSWORD_REQUIRED:")) {
            const sshpassAvailable = await tauriInvoke<boolean>("ssh_check_sshpass_available").catch(() => false)
            if (sshpassAvailable) {
              dialog.show(() => (
                <DialogSshPassword
                  host={profile.host}
                  user={profile.user}
                  onConfirm={(pwd) => {
                    handleConnect(profile, pwd)
                  }}
                  onCancel={() => {}}
                />
              ))
              return
            }
          }
          throw error
        }
      } else {
        showToast({ title: "Manual entry", description: `Connecting to ${hostString}...` })
      }
    } catch (error) {
      showToast({
        title: "Connection failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }
  }

  const handleDelete = async (profile: ConnectionProfile) => {
    if (!confirm(`Are you sure you want to delete the profile "${profile.name}"?`)) {
      return
    }

    try {
      await ssh.deleteProfile(profile.id)
      showToast({ title: "Profile deleted", description: `SSH profile "${profile.name}" has been deleted.` })
    } catch (error) {
      showToast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }
  }

  const getStateColor = (state: ConnectionState | null) => {
    switch (state) {
      case ConnectionState.Connected:
        return "bg-icon-success-base"
      case ConnectionState.Starting:
      case ConnectionState.Discovering:
      case ConnectionState.Bootstrapping:
      case ConnectionState.Reconnecting:
        return "bg-icon-warning-base"
      case ConnectionState.Failed:
        return "bg-icon-critical-base"
      default:
        return "bg-border-weak-base"
    }
  }

  const getStateLabel = (state: ConnectionState | null) => {
    switch (state) {
      case ConnectionState.Connected:
        return "Connected"
      case ConnectionState.Starting:
        return "Starting"
      case ConnectionState.Discovering:
        return "Discovering"
      case ConnectionState.Bootstrapping:
        return "Bootstrapping"
      case ConnectionState.Reconnecting:
        return "Reconnecting"
      case ConnectionState.Failed:
        return "Failed"
      default:
        return "Idle"
    }
  }

  return (
    <div class="flex flex-col gap-2">
      <For each={profiles()}>
        {(profile) => {
          const state = getConnectionState(profile.id)
          const connection = getConnection(profile.id)
          const isConnected = state === ConnectionState.Connected
          const isConnecting =
            state === ConnectionState.Starting ||
            state === ConnectionState.Discovering ||
            state === ConnectionState.Bootstrapping ||
            state === ConnectionState.Reconnecting

          return (
            <div class="flex items-center gap-2 p-2 rounded-lg border border-border-weak-base bg-background-base">
              <div class={`size-1.5 rounded-full shrink-0 ${getStateColor(state)}`} />
              <div class="flex-1 min-w-0">
                <div class="text-14-regular text-text-strong truncate">{profile.name}</div>
                <div class="text-12-regular text-text-weak truncate">
                  {profile.user ? `${profile.user}@` : ""}
                  {profile.host}
                  {profile.port && profile.port !== 22 ? `:${profile.port}` : ""}
                </div>
                <Show when={state}>
                  <div class="text-12-regular text-text-weak">{getStateLabel(state)}</div>
                </Show>
                <Show when={connection?.error && connection.error.message && connection.error.message !== "Connection lost" && connection.error.message !== "Connection terminated"}>
                  <div class="text-12-regular text-text-critical mt-1">{connection?.error?.message}</div>
                </Show>
              </div>
              <div class="flex items-center gap-1">
                <Show when={!isConnected && !isConnecting}>
                  <Button variant="secondary" size="small" onClick={() => handleConnect(profile)}>
                    Connect
                  </Button>
                </Show>
                <Show when={isConnected || isConnecting}>
                  <Button variant="ghost" size="small" onClick={() => handleDisconnect(profile)} disabled={isConnecting}>
                    Disconnect
                  </Button>
                </Show>
                <IconButton icon="edit-small-2" variant="ghost" onClick={() => handleEdit(profile)} />
                <IconButton icon="circle-x" variant="ghost" onClick={() => handleDelete(profile)} />
              </div>
            </div>
          )
        }}
      </For>

      <Show when={configHosts().length > 0}>
        <div class="text-12-regular text-text-weak px-3 mt-2">
          {configHosts().length} host{configHosts().length !== 1 ? "s" : ""} from ~/.ssh/config
        </div>
      </Show>

      <Show when={profiles().length === 0 && configHosts().length === 0}>
        <div class="text-14-regular text-text-weak text-center py-4">No SSH hosts configured</div>
      </Show>
    </div>
  )
}
