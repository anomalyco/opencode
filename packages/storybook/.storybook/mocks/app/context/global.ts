import { ServerConnection } from "./server"

const mockConn: ServerConnection.Http = {
  type: "http",
  http: { url: "http://localhost:3000" },
}

const mockServerCtx = {
  sdk: { api: { session: { rename: async () => {} } } },
  sync: {
    session: {
      peek: () => undefined,
      resolve: async () => undefined,
    },
    ensureDirSyncContext: () => ({
      session: { sync: async () => {} },
    }),
  },
  projects: {
    list: () => [{ worktree: "/home/user/project", expanded: true }],
  },
}

export function useGlobal() {
  return {
    servers: {
      list: () => [mockConn],
    },
    ensureServerCtx: () => mockServerCtx,
  }
}
