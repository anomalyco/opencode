import { afterEach, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"

let active: ReturnType<typeof fixture>

mock.module("@/workspaces/location", () => ({
  useWorkspaceLocation: () => () => ({ directory: active.directory }),
}))
mock.module("@/runtime/server/client", () => ({ useServerSDK: () => active.sdk }))
mock.module("@/runtime/server/current", () => ({ useData: () => active.data }))
mock.module("@/settings/model", () => ({
  useSettings: () => ({
    workspaces: { defaultDestination: () => "local", lastUsed: () => undefined },
  }),
}))
mock.module("@/shell/tabs/tabs", () => ({ useTabs: () => ({}) }))

const { createNewSessionWorkspaceController } = await import("@/new-session/workspace/controller")

const cleanups: Array<() => void> = []

afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))

function fixture(directory: string, canonical: string) {
  const project = {
    id: "project",
    canonical: "/project",
    vcs: "git",
    worktrees: ["/project", "/project/feature", "/project/other"].map((directory) => ({ directory })),
  }
  const [selection, setSelection] = createStore<{ worktree: string; branch?: string }>({ worktree: "main" })
  const [vcs, setVcs] = createStore<Record<string, { branch: { current: string } }>>({
    "/project/feature": { branch: { current: "feature" } },
  })
  const requests: string[] = []

  return {
    directory,
    selection,
    setSelection,
    setVcs,
    requests,
    sdk: {
      api: {
        worktree: { list: async () => project.worktrees },
        vcs: { branch: { list: async () => ({ data: ["dev", "feature"] }) } },
      },
      event: { listen: () => () => {} },
    },
    data: {
      location: {
        info: () => ({ project: { id: project.id, canonical } }),
        syncInfo: async () => {},
        vcs: {
          info: (input: { directory: string }) => vcs[input.directory],
          sync: async (input: { directory: string }) => {
            requests.push(input.directory)
          },
        },
      },
      project: { get: () => project, sync: async () => {} },
    },
  }
}

test.each([
  { directory: "/project/feature", canonical: "/project", branch: "dev", expected: ["/project", "/project/feature"] },
  { directory: "/project", canonical: "/project", branch: "dev", expected: ["/project"] },
  { directory: "/clone", canonical: "/clone", branch: "release", expected: ["/clone"] },
])(
  "Local loads its canonical branch without warming other worktrees from $directory",
  ({ directory, canonical, branch, expected }) => {
    active = fixture(directory, canonical)

    const controller = createRoot((dispose) => {
      cleanups.push(dispose)

      return createNewSessionWorkspaceController({
        selectedWorktree: () => active.selection.worktree,
        selectedBranch: () => active.selection.branch,
        setSelectedWorktree: (worktree) => active.setSelection("worktree", worktree ?? "main"),
        setSelectedBranch: (branch) => active.setSelection("branch", branch),
        onViewAll() {},
      })
    })

    expect(active.requests.toSorted()).toEqual(expected)
    expect(controller.bar.branch()).toBeUndefined()

    active.setVcs(canonical, { branch: { current: branch } })
    expect(controller.bar.branch()).toBe(branch)

    active.setSelection("worktree", "/project/feature")
    expect(controller.bar.branch()).toBe("feature")

    const requests = [...active.requests]
    active.setSelection("worktree", "create")
    expect(controller.bar.branch()).toBe(directory === "/project/feature" ? "feature" : branch)
    expect(active.requests).toEqual(requests)
  },
)
