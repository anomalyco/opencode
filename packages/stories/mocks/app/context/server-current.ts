// Stories render without a connected server: no location has synced integrations or usage limits yet.
const data = {
  session: {
    form: {
      reply: async () => {},
      cancel: async () => {},
    },
  },
  location: {
    default: () => ({ directory: "/tmp/story" }),
    syncInfo: async () => {},
    integration: {
      list: () => undefined,
      sync: async () => {},
    },
    usage: {
      limits: () => undefined,
      sync: async () => {},
      invalidate: () => {},
    },
  },
}

export function useServer() {
  return { ctx: { data } }
}

export function useData() {
  return data
}

export function ServerProvider(props: { children?: unknown }) {
  return props.children
}
