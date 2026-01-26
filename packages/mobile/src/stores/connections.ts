import { create } from "zustand"
import * as SecureStore from "expo-secure-store"
import type { ServerConnection, ConnectionType } from "../lib/types"
import { createClient, type Client, type Project } from "../lib/sdk"

const CONNECTIONS_KEY = "opencode_connections"
const PASSWORDS_PREFIX = "opencode_password_"
const RECENT_DIRS_KEY = "opencode_recent_dirs"
const MAX_RECENT_DIRS = 10

// Cached auth so we can create directory-scoped clients without async SecureStore lookups
interface ClientBase {
  baseUrl: string
  auth?: { username: string; password: string }
}

interface ConnectionsState {
  connections: ServerConnection[]
  activeConnection: ServerConnection | null
  client: Client | null
  clientBase: ClientBase | null
  currentProject: Project | null
  serverHome: string | null // Home directory on the server machine (for ~ expansion)
  recentDirectories: string[]
  isLoading: boolean
  error: string | null

  // Actions
  loadConnections: () => Promise<void>
  addConnection: (connection: Omit<ServerConnection, "id">, password?: string) => Promise<void>
  removeConnection: (id: string) => Promise<void>
  setActiveConnection: (id: string) => Promise<void>
  testConnection: (connection: ServerConnection, password?: string) => Promise<boolean>
  updateConnection: (id: string, updates: Partial<ServerConnection>) => Promise<void>
  refreshProject: () => Promise<void>
  // Create a one-off client pointing at a specific directory (for cross-project operations)
  clientForDirectory: (directory: string) => Client | null
  // Switch the active connection's directory and reload
  switchDirectory: (directory?: string) => Promise<void>
  // Record a directory as recently used
  addRecentDirectory: (directory: string) => Promise<void>
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}

function buildClient(
  url: string,
  directory?: string,
  auth?: { username: string; password: string },
): { client: Client; base: ClientBase } {
  const base: ClientBase = { baseUrl: url, auth }
  const client = createClient({ baseUrl: url, directory, auth })
  return { client, base }
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  activeConnection: null,
  client: null,
  clientBase: null,
  serverHome: null,
  currentProject: null,
  recentDirectories: [],
  isLoading: true,
  error: null,

  loadConnections: async () => {
    try {
      set({ isLoading: true, error: null })
      const [stored, recentRaw] = await Promise.all([
        SecureStore.getItemAsync(CONNECTIONS_KEY),
        SecureStore.getItemAsync(RECENT_DIRS_KEY),
      ])
      const connections: ServerConnection[] = stored ? JSON.parse(stored) : []
      const recentDirectories: string[] = recentRaw ? JSON.parse(recentRaw) : []

      // Find active connection
      const active = connections.find((c) => c.active) || null

      // Create client for active connection
      let client: Client | null = null
      let base: ClientBase | null = null
      let project: Project | null = null
      let home: string | null = null
      if (active) {
        const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${active.id}`)
        const auth = active.username && password ? { username: active.username, password } : undefined
        const built = buildClient(active.url, active.directory, auth)
        client = built.client
        base = built.base
        // Fetch current project info and server paths
        try {
          const [proj, paths] = await Promise.all([
            client.project.current().catch(() => null),
            client.path.get().catch(() => null),
          ])
          project = proj
          home = paths?.home || null
        } catch {
          // Server might be offline
        }
      }

      set({
        connections,
        activeConnection: active,
        client,
        clientBase: base,
        currentProject: project,
        serverHome: home,
        recentDirectories,
        isLoading: false,
      })
    } catch (error) {
      set({ error: "Failed to load connections", isLoading: false })
    }
  },

  addConnection: async (connection, password) => {
    const id = generateId()
    const newConnection: ServerConnection = {
      ...connection,
      id,
      active: get().connections.length === 0, // First connection is active
    }

    const connections = [...get().connections, newConnection]

    // Store password separately if provided
    if (password) {
      await SecureStore.setItemAsync(`${PASSWORDS_PREFIX}${id}`, password)
    }

    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    // If this is the first/active connection, create client
    let client = get().client
    let base = get().clientBase
    let activeConnection = get().activeConnection

    if (newConnection.active) {
      activeConnection = newConnection
      const auth = newConnection.username && password ? { username: newConnection.username, password } : undefined
      const built = buildClient(newConnection.url, newConnection.directory, auth)
      client = built.client
      base = built.base
    }

    set({ connections, activeConnection, client, clientBase: base })
  },

  removeConnection: async (id) => {
    const connections = get().connections.filter((c) => c.id !== id)

    // Remove stored password
    await SecureStore.deleteItemAsync(`${PASSWORDS_PREFIX}${id}`)
    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    // If removing active connection, clear client
    const wasActive = get().activeConnection?.id === id
    if (wasActive) {
      const newActive = connections[0] || null
      if (newActive) {
        // Mark new connection as active
        newActive.active = true
        await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))
        const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${newActive.id}`)
        const auth = newActive.username && password ? { username: newActive.username, password } : undefined
        const built = buildClient(newActive.url, newActive.directory, auth)
        set({ connections, activeConnection: newActive, client: built.client, clientBase: built.base })
      } else {
        set({ connections, activeConnection: null, client: null, clientBase: null })
      }
    } else {
      set({ connections })
    }
  },

  setActiveConnection: async (id) => {
    const connections = get().connections.map((c) => ({
      ...c,
      active: c.id === id,
    }))

    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    const active = connections.find((c) => c.id === id) || null
    let client: Client | null = null
    let base: ClientBase | null = null
    let project: Project | null = null
    let home: string | null = null

    if (active) {
      const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${active.id}`)
      const auth = active.username && password ? { username: active.username, password } : undefined
      const built = buildClient(active.url, active.directory, auth)
      client = built.client
      base = built.base

      try {
        const [proj, paths] = await Promise.all([
          client.project.current().catch(() => null),
          client.path.get().catch(() => null),
        ])
        project = proj
        home = paths?.home || null
      } catch {
        // Server might be offline
      }

      // Update last connected time
      active.lastConnected = Date.now()
      await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))
    }

    set({ connections, activeConnection: active, client, clientBase: base, currentProject: project, serverHome: home })
  },

  testConnection: async (connection, password) => {
    try {
      const client = createClient({
        baseUrl: connection.url,
        directory: connection.directory,
        auth: connection.username && password ? { username: connection.username, password } : undefined,
      })

      await client.global.health()
      return true
    } catch {
      return false
    }
  },

  updateConnection: async (id, updates) => {
    const connections = get().connections.map((c) => (c.id === id ? { ...c, ...updates } : c))

    await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(connections))

    // If updating active connection, recreate client
    if (get().activeConnection?.id === id) {
      const active = connections.find((c) => c.id === id)!
      const password = await SecureStore.getItemAsync(`${PASSWORDS_PREFIX}${id}`)
      const auth = active.username && password ? { username: active.username, password } : undefined
      const built = buildClient(active.url, active.directory, auth)
      try {
        const [project, paths] = await Promise.all([
          built.client.project.current().catch(() => null),
          built.client.path.get().catch(() => null),
        ])
        set({
          connections,
          activeConnection: active,
          client: built.client,
          clientBase: built.base,
          currentProject: project,
          serverHome: paths?.home || null,
        })
      } catch {
        set({
          connections,
          activeConnection: active,
          client: built.client,
          clientBase: built.base,
          currentProject: null,
        })
      }
    } else {
      set({ connections })
    }
  },

  refreshProject: async () => {
    const client = get().client
    if (!client) return

    try {
      const project = await client.project.current()
      set({ currentProject: project })
    } catch {
      set({ currentProject: null })
    }
  },

  clientForDirectory: (directory) => {
    const base = get().clientBase
    if (!base) return null
    // Reuse current client if directory matches
    const active = get().activeConnection
    if (active?.directory === directory) return get().client
    return createClient({ baseUrl: base.baseUrl, directory, auth: base.auth })
  },

  switchDirectory: async (directory) => {
    const active = get().activeConnection
    if (!active) return
    // Update connection directory and recreate client
    const dir = directory?.trim() || undefined
    await get().updateConnection(active.id, { directory: dir })
    // Record in recents if it's a real directory
    if (dir) await get().addRecentDirectory(dir)
  },

  addRecentDirectory: async (directory) => {
    const current = get().recentDirectories
    // Move to front, dedup, cap at MAX
    const updated = [directory, ...current.filter((d) => d !== directory)].slice(0, MAX_RECENT_DIRS)
    set({ recentDirectories: updated })
    await SecureStore.setItemAsync(RECENT_DIRS_KEY, JSON.stringify(updated))
  },
}))
