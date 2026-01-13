import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"

function mapConnectionState(state: string): ConnectionState {
  switch (state) {
    case "starting": return ConnectionState.Starting
    case "discovering": return ConnectionState.Discovering
    case "bootstrapping": return ConnectionState.Bootstrapping
    case "connected": return ConnectionState.Connected
    case "reconnecting": return ConnectionState.Reconnecting
    case "failed": return ConnectionState.Failed
    default: return ConnectionState.Idle
  }
}

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    throw new Error("Tauri API not available")
  }
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export interface ConnectionProfile {
  id: string
  name: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  sshConfigMode?: "pass-through" | "isolation"
  remoteServerPorts: number[]
  remoteHost: string
  bootstrapEnabled: boolean
  autoReconnect: boolean
  createdAt: string
  lastUsed?: string
}

export interface SshConfigHost {
  name: string
  host: string
  user?: string
  port?: number
  identity_file?: string
  proxy_jump?: string
}

export enum ConnectionState {
  Idle = "idle",
  Starting = "starting",
  Discovering = "discovering",
  Bootstrapping = "bootstrapping",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Failed = "failed",
}

export interface Connection {
  id: string
  profileId: string
  state: ConnectionState
  localEndpoint?: { host: string; port: number }
  serverInfo?: { healthy: true; version: string }
  error?: {
    type: string
    message: string
    details?: string
  }
  createdAt: string
  connectedAt?: string
}

interface TauriConnectionProfile {
  id: string
  name: string
  host: string
  user?: string
  port?: number
  identity_file?: string
  proxy_jump?: string
  ssh_config_mode?: string
  remote_server_ports: number[]
  remote_host: string
  bootstrap_enabled: boolean
  auto_reconnect: boolean
  created_at: string
  last_used?: string
}

function toTauriProfile(profile: ConnectionProfile): TauriConnectionProfile {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    user: profile.user,
    port: profile.port,
    identity_file: profile.identityFile,
    proxy_jump: profile.proxyJump,
    ssh_config_mode: profile.sshConfigMode,
    remote_server_ports: profile.remoteServerPorts,
    remote_host: profile.remoteHost,
    bootstrap_enabled: profile.bootstrapEnabled,
    auto_reconnect: profile.autoReconnect,
    created_at: profile.createdAt,
    last_used: profile.lastUsed,
  }
}

function fromTauriProfile(profile: TauriConnectionProfile): ConnectionProfile {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    user: profile.user,
    port: profile.port,
    identityFile: profile.identity_file,
    proxyJump: profile.proxy_jump,
    sshConfigMode:
      profile.ssh_config_mode === "pass-through" || profile.ssh_config_mode === "isolation"
        ? profile.ssh_config_mode
        : undefined,
    remoteServerPorts: profile.remote_server_ports,
    remoteHost: profile.remote_host,
    bootstrapEnabled: profile.bootstrap_enabled,
    autoReconnect: profile.auto_reconnect,
    createdAt: profile.created_at,
    lastUsed: profile.last_used,
  }
}

export const { use: useSsh, provider: SshProvider } = createSimpleContext({
  name: "SSH",
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const isDesktop = platform.platform === "desktop"

    if (!isDesktop) {
      return {
        profiles: () => [],
        configHosts: () => [],
        connections: () => [],
        loading: () => false,
        refreshProfiles: async () => {},
        refreshConfigHosts: async () => {},
        saveProfile: async () => {
          throw new Error("SSH profiles only available on desktop")
        },
        deleteProfile: async () => {
          throw new Error("SSH profiles only available on desktop")
        },
        connect: async () => {
          throw new Error("SSH connections only available on desktop")
        },
        disconnect: async () => {},
        getConnectionByProfile: () => null,
        getProfileAddressForUrl: () => null,
      }
    }

    const [profiles, setProfiles] = createStore<ConnectionProfile[]>([])
    const [configHosts, setConfigHosts] = createStore<SshConfigHost[]>([])
    const [connections, setConnections] = createStore<Record<string, Connection>>({})
    const [loading, setLoading] = createSignal(false)
    const pollingIntervals = new Map<string, ReturnType<typeof setInterval>>()
    
    const [connectedProfilesStore, setConnectedProfiles, _, connectedProfilesReady] = persisted(
      Persist.global("ssh-connected-profiles", ["ssh-connected-profiles.v1"]),
      createStore<{ profiles: string[] }>({ profiles: [] }),
    )

    const [profilesResource] = createResource(
      () => isDesktop,
      async (shouldLoad) => {
        if (!shouldLoad) return []
        try {
          const tauriProfiles = await tauriInvoke<TauriConnectionProfile[]>("ssh_list_profiles")
          return tauriProfiles.map(fromTauriProfile)
        } catch (error) {
          console.error("Failed to load SSH profiles:", error)
          return []
        }
      },
    )

    const [configHostsResource] = createResource(
      () => isDesktop,
      async (shouldLoad) => {
        if (!shouldLoad) return []
        try {
          const hosts = await tauriInvoke<SshConfigHost[]>("ssh_list_config_hosts")
          return hosts
        } catch (error) {
          console.error("Failed to load SSH config hosts:", error)
          return []
        }
      },
    )

    createEffect(() => {
      const loaded = profilesResource()
      if (loaded) {
        setProfiles(loaded)
      }
    })

    createEffect(() => {
      const loaded = configHostsResource()
      if (loaded) {
        setConfigHosts(loaded)
      }
    })

    const [connectionsResource] = createResource(
      () => isDesktop,
      async (shouldLoad) => {
        if (!shouldLoad) return []
        try {
          const tauriConnections = await tauriInvoke<any[]>("ssh_list_connections")
          return tauriConnections.map((c) => {
            return {
              id: c.id,
              profileId: c.profile_id,
              state: mapConnectionState(c.state),
              localEndpoint: c.local_endpoint
                ? {
                    host: c.local_endpoint.host,
                    port: c.local_endpoint.port,
                  }
                : undefined,
              serverInfo: c.server_info,
              error: c.error,
              createdAt: c.created_at,
              connectedAt: c.connected_at,
            } as Connection
          })
        } catch (error) {
          console.error("Failed to load SSH connections:", error)
          return []
        }
      },
    )

    let startupEffectRun = false
    let startupCleanupRun = false
    createEffect(() => {
      const loadedConnections = connectionsResource()
      const loadedProfiles = profilesResource()
      
      if (loadedConnections && loadedProfiles && connectedProfilesReady() && !startupCleanupRun) {
        startupCleanupRun = true
        const activeConnectionUrls = new Set<string>()
        for (const conn of loadedConnections) {
          if (conn.state === ConnectionState.Connected && conn.localEndpoint) {
            const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
            activeConnectionUrls.add(url)
          }
        }
        
        const serversToRemove: string[] = []
        for (const serverUrl of server.list) {
          if (serverUrl.startsWith("http://127.0.0.1:") && !activeConnectionUrls.has(serverUrl)) {
            serversToRemove.push(serverUrl)
          }
        }
        
        for (const url of serversToRemove) {
          console.log("[SSH Frontend] Startup cleanup - removing orphaned server:", url)
          server.remove(url)
        }
        
        if (serversToRemove.length > 0) {
          console.log("[SSH Frontend] Startup cleanup - removed", serversToRemove.length, "orphaned servers")
        }
      }
      
      console.log("[SSH Frontend] Startup effect running, loadedConnections:", loadedConnections?.length, "loadedProfiles:", loadedProfiles?.length, "connectedProfilesReady:", connectedProfilesReady(), "startupEffectRun:", startupEffectRun)
      
      if (loadedConnections && loadedProfiles && connectedProfilesReady()) {
        if (!startupEffectRun) {
          startupEffectRun = true
          console.log("[SSH Frontend] Startup effect - loading connections from backend:", loadedConnections.length)
          for (const conn of loadedConnections) {
            setConnections(conn.id, conn)
            
            if (conn.state === ConnectionState.Connected && conn.localEndpoint) {
              const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
              if (!server.list.includes(url)) {
                server.add(url)
              } else if (server.url !== url) {
                server.setActive(url)
              }
            } else if (conn.state !== ConnectionState.Connected && conn.localEndpoint) {
              const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
              if (server.list.includes(url)) {
                console.log("[SSH Frontend] Startup - removing server for non-connected connection:", url)
                server.remove(url)
              }
            }
            
            const needsPolling = conn.state === ConnectionState.Starting ||
              conn.state === ConnectionState.Discovering ||
              conn.state === ConnectionState.Bootstrapping ||
              conn.state === ConnectionState.Reconnecting
            
            if (needsPolling && !pollingIntervals.has(conn.id)) {
              const connectionId = conn.id
              const pollState = setInterval(async () => {
                if (!pollingIntervals.has(connectionId)) {
                  return
                }

                try {
                  const state = await tauriInvoke<string>("ssh_get_connection_state", { connectionId })
                  const fullConnectionData = await tauriInvoke<any | null>("ssh_get_connection", { connectionId })
                  
                  if (!pollingIntervals.has(connectionId)) {
                    return
                  }

                  const connectionState = fullConnectionData?.state || state
                  const mappedState = mapConnectionState(connectionState)
                  
                  const fullConnection: Connection | null = fullConnectionData
                    ? {
                        id: fullConnectionData.id,
                        profileId: fullConnectionData.profile_id || fullConnectionData.profileId,
                        state: mappedState,
                        localEndpoint: (fullConnectionData.local_endpoint || fullConnectionData.localEndpoint)
                          ? {
                              host: (fullConnectionData.local_endpoint || fullConnectionData.localEndpoint).host,
                              port: (fullConnectionData.local_endpoint || fullConnectionData.localEndpoint).port,
                            }
                          : undefined,
                        serverInfo: fullConnectionData.server_info || fullConnectionData.serverInfo,
                        error: fullConnectionData.error,
                        createdAt: fullConnectionData.created_at || fullConnectionData.createdAt,
                        connectedAt: fullConnectionData.connected_at || fullConnectionData.connectedAt,
                      }
                    : null

                  if (fullConnection && pollingIntervals.has(connectionId)) {
                    const previousConnection = connections[fullConnection.id]
                    const previousState = previousConnection?.state
                    
                    setConnections(fullConnection.id, fullConnection)

                    if (fullConnection.state === ConnectionState.Connected && fullConnection.localEndpoint) {
                      const url = `http://${fullConnection.localEndpoint.host}:${fullConnection.localEndpoint.port}`
                      if (!server.list.includes(url)) {
                        server.add(url)
                      } else if (server.url !== url) {
                        server.setActive(url)
                      }
                      
                      if (connectedProfilesReady()) {
                        if (!connectedProfilesStore.profiles.includes(fullConnection.profileId)) {
                          setConnectedProfiles("profiles", connectedProfilesStore.profiles.length, fullConnection.profileId)
                        }
                      }
                    } else if (fullConnection.state === ConnectionState.Failed && previousState === ConnectionState.Connected && previousConnection?.localEndpoint) {
                      const url = `http://${previousConnection.localEndpoint.host}:${previousConnection.localEndpoint.port}`
                      if (server.list.includes(url)) {
                        server.remove(url)
                      }
                      
                      if (connectedProfilesReady()) {
                        const index = connectedProfilesStore.profiles.indexOf(fullConnection.profileId)
                        if (index !== -1) {
                          setConnectedProfiles("profiles", (prev) => prev.filter((id) => id !== fullConnection.profileId))
                        }
                      }
                    }
                  }

                  if (state === "failed" || state === "idle" || state === "connected") {
                    const interval = pollingIntervals.get(connectionId)
                    if (interval) {
                      clearInterval(interval)
                      pollingIntervals.delete(connectionId)
                    }
                  }
                } catch (error) {
                  console.error("Failed to poll connection state:", error)
                  const interval = pollingIntervals.get(connectionId)
                  if (interval) {
                    clearInterval(interval)
                    pollingIntervals.delete(connectionId)
                  }
                }
              }, 1000)
              pollingIntervals.set(connectionId, pollState)
            }
          }
          
          for (const profileId of connectedProfilesStore.profiles) {
            const profile = loadedProfiles.find((p) => p.id === profileId)
            if (profile?.autoReconnect) {
              const existingConnection = loadedConnections.find((c) => c.profileId === profileId && c.state === ConnectionState.Connected)
              if (!existingConnection) {
                console.log("[SSH Frontend] Auto-reconnecting profile on startup:", profile.id)
                setTimeout(() => {
                  connect(profile.id).catch((error) => {
                    console.error("[SSH Frontend] Auto-reconnect on startup failed:", error)
                    const index = connectedProfilesStore.profiles.indexOf(profile.id)
                    if (index !== -1) {
                      setConnectedProfiles("profiles", (prev) => prev.filter((id) => id !== profile.id))
                    }
                  })
                }, 2000)
              }
            }
          }
        }
      }
    })

    const refreshProfiles = async () => {
      if (!isDesktop) return
      try {
        const tauriProfiles = await tauriInvoke<TauriConnectionProfile[]>("ssh_list_profiles")
        setProfiles(tauriProfiles.map(fromTauriProfile))
      } catch (error) {
        console.error("Failed to refresh SSH profiles:", error)
      }
    }

    const saveProfile = async (profile: ConnectionProfile): Promise<void> => {
      if (!isDesktop) return
      setLoading(true)
      try {
        await tauriInvoke("ssh_save_profile", { profile: toTauriProfile(profile) })
        await refreshProfiles()
      } catch (error) {
        console.error("Failed to save SSH profile:", error)
        throw error
      } finally {
        setLoading(false)
      }
    }

    const deleteProfile = async (id: string): Promise<void> => {
      if (!isDesktop) return
      setLoading(true)
      try {
        await tauriInvoke("ssh_delete_profile", { id })
        await refreshProfiles()
        const connection = Object.values(connections).find((c) => c.profileId === id)
        if (connection) {
          await disconnect(connection.id)
        }
      } catch (error) {
        console.error("Failed to delete SSH profile:", error)
        throw error
      } finally {
        setLoading(false)
      }
    }

    const connect = async (profileId: string, password?: string): Promise<Connection> => {
      console.log("[SSH Frontend] connect() called for profileId:", profileId, "withPassword:", !!password)
      
      if (!isDesktop) {
        console.error("[SSH Frontend] Not on desktop, cannot connect")
        throw new Error("SSH connections only available on desktop")
      }

      const existing = Object.values(connections).find(
        (c) => c.profileId === profileId && c.state === ConnectionState.Connected,
      )
      if (existing) {
        console.log("[SSH Frontend] Found existing connected connection:", existing.id)
        return existing
      }

      const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`
      console.log("[SSH Frontend] Creating new connection:", connectionId, "for profile:", profileId)
      
      const connection: Connection = {
        id: connectionId,
        profileId,
        state: ConnectionState.Starting,
        createdAt: new Date().toISOString(),
      }

      setConnections(connectionId, connection)
      console.log("[SSH Frontend] Connection added to store:", connectionId, "current connections:", Object.keys(connections))

      try {
        console.log("[SSH Frontend] Invoking ssh_connect_profile with profileId:", profileId, "connectionId:", connectionId)
        let result: any
        try {
          result = await tauriInvoke<any>("ssh_connect_profile", {
            profileId,
            connectionId,
            password: password || null,
          })
          console.log("[SSH Frontend] Backend returned result:", result)
          console.log("[SSH Frontend] Result is:", result ? "truthy" : "falsy", "type:", typeof result)
        } catch (invokeError) {
          console.error("[SSH Frontend] ERROR: tauriInvoke failed:", invokeError)
          throw invokeError
        }

        console.log("[SSH Frontend] Connection result:", result)
        console.log("[SSH Frontend] Connection state:", result.state, "serverInfo:", result.server_info, "localEndpoint:", result.local_endpoint)
        console.log("[SSH Frontend] Full result keys:", Object.keys(result))
        console.log("[SSH Frontend] Result type check - state type:", typeof result.state, "local_endpoint type:", typeof result.local_endpoint, "server_info type:", typeof result.server_info)

        const conn: Connection = {
          id: result.id || connectionId,
          profileId: result.profile_id,
          state: mapConnectionState(result.state),
          localEndpoint: result.local_endpoint
            ? {
                host: result.local_endpoint.host,
                port: result.local_endpoint.port,
              }
            : undefined,
          serverInfo: result.server_info,
          error: result.error,
          createdAt: result.created_at,
          connectedAt: result.connected_at,
        }
        const finalConnectionId = conn.id
        console.log("[SSH Frontend] Updating connection in store:", finalConnectionId, "state:", conn.state, "before update, connections:", Object.keys(connections))
        console.log("[SSH Frontend] Connection object:", JSON.stringify(conn, null, 2))
        console.log("[SSH Frontend] Connection state enum value:", conn.state, "ConnectionState.Connected enum value:", ConnectionState.Connected, "Are they equal?", conn.state === ConnectionState.Connected)
        setConnections(finalConnectionId, conn)
        console.log("[SSH Frontend] After update, connections:", Object.keys(connections))

        console.log("[SSH Frontend] Checking if should add server - state:", conn.state, "localEndpoint:", conn.localEndpoint, "state === Connected:", conn.state === ConnectionState.Connected)
        console.log("[SSH Frontend] Condition check - conn.state === ConnectionState.Connected:", conn.state === ConnectionState.Connected, "conn.localEndpoint:", !!conn.localEndpoint, "combined:", conn.state === ConnectionState.Connected && !!conn.localEndpoint)
        if (conn.state === ConnectionState.Connected && conn.localEndpoint) {
          const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
          console.log("[SSH Frontend] Adding server to list:", url, "current servers:", server.list, "current active:", server.url, "serverInfo:", conn.serverInfo)
          console.log("[SSH Frontend] Connection state check passed - state:", conn.state, "localEndpoint:", conn.localEndpoint)
          
          if (conn.serverInfo) {
            console.log("[SSH Frontend] Server info available:", conn.serverInfo)
            console.log("[SSH Frontend] Server is healthy, switching to SSH server:", url)
          } else {
            console.warn("[SSH Frontend] WARNING: Connection shows as connected but no serverInfo - server may not be accessible")
            console.warn("[SSH Frontend] This suggests bootstrap may not have worked or server is not running")
          }
          
          console.log("[SSH Frontend] About to call server.add() with URL:", url)
          if (!(window as any).__lastServerAdd) {
            (window as any).__lastServerAdd = {}
          }
          (window as any).__lastServerAdd[url] = Date.now()
          server.add(url)
          console.log("[SSH Frontend] Server added and set as active, new active:", server.url, "new list:", server.list, "SDK should now use this URL")
          
          if (connectedProfilesReady()) {
            if (!connectedProfilesStore.profiles.includes(conn.profileId)) {
              setConnectedProfiles("profiles", connectedProfilesStore.profiles.length, conn.profileId)
            }
          }
        } else {
          console.warn("[SSH Frontend] Connection result shows state:", conn.state, "localEndpoint:", conn.localEndpoint, "error:", conn.error)
          console.warn("[SSH Frontend] State value:", conn.state, "Expected:", ConnectionState.Connected, "Match:", conn.state === ConnectionState.Connected)
          console.warn("[SSH Frontend] localEndpoint value:", conn.localEndpoint)
          
          if (conn.localEndpoint && (conn.state === ConnectionState.Connected || result.state === "connected")) {
            const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
            console.warn("[SSH Frontend] FALLBACK: Adding server despite state check failure. URL:", url, "state:", conn.state, "raw state:", result.state)
            server.add(url)
            console.warn("[SSH Frontend] FALLBACK: Server added, new list:", server.list, "new active:", server.url)
          }
          
          if (conn.state === ConnectionState.Failed && conn.localEndpoint) {
            const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
            if (server.list.includes(url)) {
              console.log("[SSH Frontend] Removing server for failed connection:", url)
              server.remove(url)
            }
          }
        }

        const pollState = setInterval(async () => {
          if (!pollingIntervals.has(finalConnectionId)) {
            return
          }

          try {
            const state = await tauriInvoke<string>("ssh_get_connection_state", { connectionId: finalConnectionId })
            const fullConnectionData = await tauriInvoke<any | null>("ssh_get_connection", { connectionId: finalConnectionId })
            console.log("[SSH Frontend] Polling state:", state, "fullConnection:", fullConnectionData)
            
            if (!pollingIntervals.has(finalConnectionId)) {
              return
            }

            const connectionState = fullConnectionData?.state || state
            const mappedState = mapConnectionState(connectionState)
            
            const fullConnection: Connection | null = fullConnectionData
              ? {
                  id: fullConnectionData.id,
                  profileId: fullConnectionData.profile_id || fullConnectionData.profileId,
                  state: mappedState,
                  localEndpoint: (fullConnectionData.local_endpoint || fullConnectionData.localEndpoint)
                    ? {
                        host: (fullConnectionData.local_endpoint || fullConnectionData.localEndpoint).host,
                        port: (fullConnectionData.local_endpoint || fullConnectionData.localEndpoint).port,
                      }
                    : undefined,
                  serverInfo: fullConnectionData.server_info || fullConnectionData.serverInfo,
                  error: fullConnectionData.error,
                  createdAt: fullConnectionData.created_at || fullConnectionData.createdAt,
                  connectedAt: fullConnectionData.connected_at || fullConnectionData.connectedAt,
                }
              : null

            console.log("[SSH Frontend] Mapped connection:", fullConnection, "state from data:", fullConnectionData?.state, "state from poll:", state)

            if (fullConnection && pollingIntervals.has(finalConnectionId)) {
              const previousConnection = connections[fullConnection.id]
              const previousState = previousConnection?.state
              
              console.log("[SSH Frontend] Before update - connections store:", Object.keys(connections))
              setConnections(fullConnection.id, fullConnection)
              console.log("[SSH Frontend] After update - connections store:", Object.keys(connections), "connection:", connections[fullConnection.id])
              console.log("[SSH Frontend] Updated connections store for", fullConnection.id, "new state:", fullConnection.state, "previous state:", previousState)

              if (fullConnection.state === ConnectionState.Connected && fullConnection.localEndpoint) {
                const url = `http://${fullConnection.localEndpoint.host}:${fullConnection.localEndpoint.port}`
                console.log("[SSH Frontend] Polling - checking server add:", url, "in list:", server.list.includes(url), "current active:", server.url, "current servers:", server.list)
                if (!server.list.includes(url)) {
                  console.log("[SSH Frontend] Polling - adding server:", url)
                  server.add(url)
                  console.log("[SSH Frontend] Polling - server added, new list:", server.list, "new active:", server.url)
                  
                  if (!server.list.includes(url)) {
                    console.error("[SSH Frontend] Polling - ERROR: server.add() was called but URL is still not in list! URL:", url, "list:", server.list)
                    console.error("[SSH Frontend] Polling - Attempting direct add via setStore...")
                    try {
                      const normalizedUrl = url.replace(/\/+$/, "")
                      if (!server.list.includes(normalizedUrl)) {
                        console.error("[SSH Frontend] Polling - This should not happen - server.add() should have worked")
                      }
                    } catch (e) {
                      console.error("[SSH Frontend] Polling - Error in fallback:", e)
                    }
                  }
                } else if (server.url !== url) {
                  console.log("[SSH Frontend] Polling - server already in list, setting as active:", url)
                  server.setActive(url)
                  console.log("[SSH Frontend] Polling - server set as active, new active:", server.url)
                }
                
                if (connectedProfilesReady()) {
                  if (!connectedProfilesStore.profiles.includes(fullConnection.profileId)) {
                    setConnectedProfiles("profiles", connectedProfilesStore.profiles.length, fullConnection.profileId)
                  }
                }
              } else if (fullConnection.state === ConnectionState.Failed && previousState === ConnectionState.Connected && previousConnection?.localEndpoint) {
                const url = `http://${previousConnection.localEndpoint.host}:${previousConnection.localEndpoint.port}`
                console.log("[SSH Frontend] Connection failed, removing server:", url)
                if (server.list.includes(url)) {
                  server.remove(url)
                  console.log("[SSH Frontend] Server removed, new list:", server.list)
                }
                
                if (connectedProfilesReady()) {
                  const index = connectedProfilesStore.profiles.indexOf(fullConnection.profileId)
                  if (index !== -1) {
                    setConnectedProfiles("profiles", (prev) => prev.filter((id) => id !== fullConnection.profileId))
                  }
                }
              }
            }

            if (state === "failed" || state === "idle" || state === "connected") {
              console.log("[SSH Frontend] Stopping poll for connection", finalConnectionId, "state:", state)
              const interval = pollingIntervals.get(finalConnectionId)
              if (interval) {
                clearInterval(interval)
                pollingIntervals.delete(finalConnectionId)
              }
            }
          } catch (error) {
            console.error("Failed to poll connection state:", error)
            const interval = pollingIntervals.get(finalConnectionId)
            if (interval) {
              clearInterval(interval)
              pollingIntervals.delete(finalConnectionId)
            }
          }
        }, 1000)

        pollingIntervals.set(finalConnectionId, pollState)

        console.log("[SSH Frontend] Connection setup complete, returning connection:", conn.id, "state:", conn.state)
        return conn
      } catch (error) {
        console.error("[SSH Frontend] Connection failed with error:", error)
        console.error("[SSH Frontend] Error details:", error instanceof Error ? error.stack : String(error))
        
        const failedConnection = {
          ...connection,
          id: connectionId,
          state: ConnectionState.Failed,
          error: {
            type: "config_error",
            message: error instanceof Error ? error.message : String(error),
          },
        }
        setConnections(connectionId, failedConnection)
        console.log("[SSH Frontend] Failed connection added to store:", failedConnection.id)
        
        if (connection.localEndpoint) {
          const url = `http://${connection.localEndpoint.host}:${connection.localEndpoint.port}`
          console.log("[SSH Frontend] Connection failed during setup, removing server if added:", url)
          if (server.list.includes(url)) {
            server.remove(url)
          }
        }
        
        throw error
      }
    }

    const disconnect = async (connectionId: string): Promise<void> => {
      const interval = pollingIntervals.get(connectionId)
      if (interval) {
        clearInterval(interval)
        pollingIntervals.delete(connectionId)
      }

      const connection = connections[connectionId]
      if (!connection) {
        console.warn("[SSH Frontend] Connection not found for disconnect:", connectionId)
        return
      }

      const profileId = connection.profileId
      const localEndpoint = connection.localEndpoint

      try {
        await tauriInvoke("ssh_disconnect_profile", { connectionId })

        if (localEndpoint) {
          const url = `http://${localEndpoint.host}:${localEndpoint.port}`
          console.log("[SSH Frontend] Disconnecting - removing server:", url)
          if (server.list.includes(url)) {
            server.remove(url)
            console.log("[SSH Frontend] Server removed, new active:", server.url)
          }
        }

        if (connectedProfilesReady()) {
          const index = connectedProfilesStore.profiles.indexOf(profileId)
          if (index !== -1) {
            setConnectedProfiles("profiles", (prev) => prev.filter((id) => id !== profileId))
          }
        }

        setConnections(connectionId, {
          ...connection,
          state: ConnectionState.Idle,
          localEndpoint: undefined,
          serverInfo: undefined,
          error: undefined,
        })
      } catch (error) {
        console.error("[SSH Frontend] Failed to disconnect:", error)
        const interval = pollingIntervals.get(connectionId)
        if (interval) {
          clearInterval(interval)
          pollingIntervals.delete(connectionId)
        }
        throw error
      }
    }

    const getConnectionByProfile = (profileId: string): Connection | null => {
      return (
        Object.values(connections).find((c) => c.profileId === profileId && c.state === ConnectionState.Connected) ?? null
      )
    }

    const getProfileAddressForUrl = (url: string): string | null => {
      if (!url) return null
      try {
        const urlObj = new URL(url)
        const urlHost = urlObj.hostname
        const urlPort = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === "https:" ? 443 : 80)
        
        const conns = Object.values(connections)
        const connection = conns.find((c) => {
          if (c.state !== ConnectionState.Connected || !c.localEndpoint) return false
          return c.localEndpoint.host === urlHost && c.localEndpoint.port === urlPort
        })
        
        if (!connection) {
          console.log("[SSH] getProfileAddressForUrl: No connection found for", url, "host:", urlHost, "port:", urlPort, "available connections:", conns.map(c => ({ id: c.id, state: c.state, localEndpoint: c.localEndpoint })))
          return null
        }
        
        const profileList = profiles
        const profile = profileList.find((p) => p.id === connection.profileId)
        if (!profile) {
          console.log("[SSH] getProfileAddressForUrl: No profile found for connection", connection.profileId, "available profiles:", profileList.map(p => p.id))
          return null
        }
        
        const address = profile.user ? `${profile.user}@${profile.host}` : profile.host
        const result = profile.port && profile.port !== 22 ? `${address}:${profile.port}` : address
        console.log("[SSH] getProfileAddressForUrl: Found address for", url, "->", result)
        return result
      } catch (e) {
        console.error("[SSH] getProfileAddressForUrl: Error processing", url, e)
        return null
      }
    }

    const refreshConfigHosts = async () => {
      if (!isDesktop) return
      try {
        const hosts = await tauriInvoke<SshConfigHost[]>("ssh_list_config_hosts")
        setConfigHosts(hosts)
      } catch (error) {
        console.error("Failed to refresh SSH config hosts:", error)
      }
    }

    const cleanupOrphanedServers = () => {
      const activeConnectionUrls = new Set<string>()
      const conns = Object.values(connections)
      console.log("[SSH Frontend] cleanupOrphanedServers - checking", conns.length, "connections")
      for (const conn of conns) {
        if (conn.state === ConnectionState.Connected && conn.localEndpoint) {
          const url = `http://${conn.localEndpoint.host}:${conn.localEndpoint.port}`
          activeConnectionUrls.add(url)
          console.log("[SSH Frontend] cleanupOrphanedServers - found active connection:", url)
        }
      }
      
      const serversToRemove: string[] = []
      for (const serverUrl of server.list) {
        if (serverUrl.startsWith("http://127.0.0.1:") && !activeConnectionUrls.has(serverUrl)) {
          console.log("[SSH Frontend] cleanupOrphanedServers - marking for removal:", serverUrl, "active URLs:", Array.from(activeConnectionUrls))
          serversToRemove.push(serverUrl)
        }
      }
      
      if (serversToRemove.length > 0) {
        if (conns.length === 0) {
          console.warn("[SSH Frontend] cleanupOrphanedServers - WARNING: Would remove", serversToRemove.length, "servers but connections list is empty. This might be a timing issue. Skipping cleanup to avoid false positives.")
          console.warn("[SSH Frontend] cleanupOrphanedServers - Server list:", server.list, "Active connection URLs:", Array.from(activeConnectionUrls))
          return
        }
        
        let removedCount = 0
        for (const url of serversToRemove) {
          const wasJustAdded = Date.now() - ((window as any).__lastServerAdd?.[url] || 0) < 5000
          if (wasJustAdded) {
            console.warn("[SSH Frontend] cleanupOrphanedServers - Skipping removal of recently added server:", url)
            continue
          }
          
          console.log("[SSH Frontend] Cleaning up orphaned server:", url)
          server.remove(url)
          removedCount++
        }
        
        if (removedCount > 0) {
          console.log("[SSH Frontend] Cleaned up", removedCount, "orphaned servers")
        }
      }
    }

    createEffect(() => {
      server.list
      server.url
      connections
      
      setTimeout(() => {
        cleanupOrphanedServers()
      }, 1000)
      
      const interval = setInterval(() => {
        cleanupOrphanedServers()
      }, 30000)
      
      return () => {
        clearInterval(interval)
        for (const [connectionId, interval] of pollingIntervals.entries()) {
          clearInterval(interval)
          pollingIntervals.delete(connectionId)
        }
      }
    })

    const connectionsList = createMemo(() => {
      const conns: Connection[] = []
      for (const key in connections) {
        const conn = connections[key]
        if (conn) {
          conns.push(conn)
        }
      }
      console.log("[SSH Context] connectionsList memo computed, count:", conns.length, "connections:", conns.map(c => ({ id: c.id, profileId: c.profileId, state: c.state })))
      return conns
    })
    
    return {
      profiles: () => profiles,
      configHosts: () => configHosts,
      connections: () => {
        const result = connectionsList()
        console.log("[SSH Context] connections() called, returning:", result, "length:", result.length)
        return result
      },
      loading,
      refreshProfiles,
      refreshConfigHosts,
      saveProfile,
      deleteProfile,
      connect,
      disconnect,
      getConnectionByProfile,
      getProfileAddressForUrl,
    }
  },
})
