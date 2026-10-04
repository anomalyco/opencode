const make = (directory: string) => ({
  session: {
    create: async () => ({ data: { id: "story-session" } }),
    prompt: async () => ({ data: undefined }),
    shell: async () => ({ data: undefined }),
    command: async () => ({ data: undefined }),
    abort: async () => ({ data: undefined }),
  },
  worktree: {
    create: async () => ({ data: { directory: `${directory}/worktree-1` } }),
  },
})

const root = "/tmp/story"
const sdk = {
  directory: root,
  scope: "story-server",
  url: "http://localhost:4096",
  client: make(root),
  createClient(input: { directory: string }) {
    return make(input.directory)
  },
}

export function useSDK() {
  return () => sdk
}
