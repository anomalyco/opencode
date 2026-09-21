import {
  ServerProvider,
  useData as useServerData,
  useServer,
} from "../../../../../app/src/runtime/server/current"

export { ServerProvider, useServer }

export function useData() {
  const data = useServerData()
  const transport = (globalThis as {
    __opencodeExecutionTransport?: { pendingPermission?: () => unknown[] }
  }).__opencodeExecutionTransport
  if (!transport?.pendingPermission) return data
  return {
    ...data,
    session: {
      ...data.session,
      message: {
        ...data.session.message,
        sync: async () => undefined,
      },
      pending: {
        ...data.session.pending,
        sync: async () => undefined,
      },
      permission: {
        ...data.session.permission,
        list: (sessionID: string) => (sessionID === "root" ? transport.pendingPermission?.() : []),
        sync: async () => undefined,
      },
      form: {
        ...data.session.form,
        sync: async () => undefined,
      },
    },
  } as typeof data
}
