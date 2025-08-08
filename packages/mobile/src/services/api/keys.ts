// Unified query keys for both local and remote APIs
// This ensures consistent caching and invalidation patterns

export const queryKeys = {
  // Local database queries
  local: {
    sessions: {
      all: ["local", "sessions"] as const,
      lists: (limit?: number, offset?: number) => [...queryKeys.local.sessions.all, "list", { limit, offset }] as const,
      details: () => [...queryKeys.local.sessions.all, "detail"] as const,
      detail: (id: string) => [...queryKeys.local.sessions.details(), id] as const,
      unsynced: () => [...queryKeys.local.sessions.all, "unsynced"] as const,
      count: () => [...queryKeys.local.sessions.all, "count"] as const,
    },
    messages: {
      all: ["local", "messages"] as const,
      lists: () => [...queryKeys.local.messages.all, "list"] as const,
      list: (sessionId: string) => [...queryKeys.local.messages.lists(), { sessionId }] as const,
      listWithParts: (sessionId: string) => [...queryKeys.local.messages.lists(), "withParts", { sessionId }] as const,
      details: () => [...queryKeys.local.messages.all, "detail"] as const,
      detail: (id: string) => [...queryKeys.local.messages.details(), id] as const,
      parts: (messageId: string) => [...queryKeys.local.messages.all, "parts", messageId] as const,
      sessionParts: (sessionId: string) => [...queryKeys.local.messages.all, "sessionParts", sessionId] as const,
    },
    files: {
      all: ["local", "files"] as const,
      lists: () => [...queryKeys.local.files.all, "list"] as const,
      details: () => [...queryKeys.local.files.all, "detail"] as const,
      detail: (path: string) => [...queryKeys.local.files.details(), path] as const,
      stats: () => [...queryKeys.local.files.all, "stats"] as const,
    },
    projects: {
      all: ["local", "projects"] as const,
      lists: () => [...queryKeys.local.projects.all, "list"] as const,
      details: () => [...queryKeys.local.projects.all, "detail"] as const,
      byId: (id: string) => [...queryKeys.local.projects.details(), id] as const,
      active: () => [...queryKeys.local.projects.all, "active"] as const,
      activeServerUrl: () => [...queryKeys.local.projects.all, "activeServerUrl"] as const,
    },
    config: {
      all: ["local", "config"] as const,
      appConfig: () => [...queryKeys.local.config.all, "app"] as const,
      userSettings: () => [...queryKeys.local.config.all, "user"] as const,
      serverUrl: () => [...queryKeys.local.config.all, "serverUrl"] as const,
      currentAgent: () => [...queryKeys.local.config.all, "currentAgent"] as const,
    },
    models: {
      all: ["local", "models"] as const,
      lists: () => [...queryKeys.local.models.all, "list"] as const,
      details: () => [...queryKeys.local.models.all, "detail"] as const,
      detail: (id: string) => [...queryKeys.local.models.details(), id] as const,
    },
  },

  // Remote API queries
  remote: {
    sessions: {
      all: ["remote", "sessions"] as const,
      lists: () => [...queryKeys.remote.sessions.all, "list"] as const,
      list: (filters?: string) => [...queryKeys.remote.sessions.lists(), { filters }] as const,
      details: () => [...queryKeys.remote.sessions.all, "detail"] as const,
      detail: (id: string) => [...queryKeys.remote.sessions.details(), id] as const,
    },
    messages: {
      all: ["remote", "messages"] as const,
      lists: () => [...queryKeys.remote.messages.all, "list"] as const,
      list: (sessionId: string) => [...queryKeys.remote.messages.lists(), { sessionId }] as const,
      details: () => [...queryKeys.remote.messages.all, "detail"] as const,
      detail: (id: string) => [...queryKeys.remote.messages.details(), id] as const,
    },
    files: {
      all: ["remote", "files"] as const,
      content: (path: string) => [...queryKeys.remote.files.all, "content", path] as const,
      status: () => [...queryKeys.remote.files.all, "status"] as const,
      search: (pattern: string) => [...queryKeys.remote.files.all, "search", pattern] as const,
      findFile: (query: string) => [...queryKeys.remote.files.all, "findFile", query] as const,
      findSymbol: (query: string) => [...queryKeys.remote.files.all, "findSymbol", query] as const,
    },
    config: {
      all: ["remote", "config"] as const,
      app: () => [...queryKeys.remote.config.all, "app"] as const,
      config: () => [...queryKeys.remote.config.all, "config"] as const,
      providers: () => [...queryKeys.remote.config.all, "providers"] as const,
      modes: () => [...queryKeys.remote.config.all, "modes"] as const,
      models: () => [...queryKeys.remote.config.all, "models"] as const,
      agents: () => [...queryKeys.remote.config.all, "agents"] as const,
    },
  },

  // Cross-cutting queries that might involve both local and remote
  sync: {
    all: ["sync"] as const,
    status: () => [...queryKeys.sync.all, "status"] as const,
    pending: () => [...queryKeys.sync.all, "pending"] as const,
  },
}
