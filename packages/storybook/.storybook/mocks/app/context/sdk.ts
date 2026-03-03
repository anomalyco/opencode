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

export function useSDK() {
  return {
    directory: root,
    url: "http://localhost:4096",
    client: make(root),
    createClient(input: { directory: string }) {
      return make(input.directory)
    },
  }
}
