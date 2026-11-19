import { OpenCode } from "@opencode/client/promise"
import { createData } from "@opencode/client/solid"
import { reviewDiffs } from "@opencode/session-ui/storybook"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createFileTreeStore } from "@/workspaces/files/tree-store"
import { createPathHelpers } from "@/workspaces/files/path"
import type {
  Comment,
  Comments,
  FileContent,
  FileNode,
  Files,
  LineRange,
  MountedSession,
  SessionScreen,
} from "../../../plugin/src/gui"

export type ChangesScenario = "Changes" | "Clean" | "Read error" | "Offline"

const root = "/workspace/status-checks"

const markdown = `---
owner: Release engineering
status: In review
---
# Status checks

Use this workspace to review the active status label before the next release.

## Verification

1. Confirm the status changes to **Running checks**.
2. Review the [check results](docs/checks.csv).
3. Check the [implementation](src/status.ts) before signing off.
`

const contents = new Map<string, FileContent>([
  ["README.md", { type: "text", content: markdown }],
  [
    "src/status.ts",
    { type: "text", content: 'export const activeLabel = "Running checks"\nexport const idleLabel = "Ready"\n' },
  ],
  [
    "docs/checks.csv",
    {
      type: "text",
      content:
        "Check,Owner,Result\nStatus label,Interface,Passed\nLine comments,Review,Passed\nPage layout,Documents,Pending\n",
    },
  ],
  [
    "docs/protected.docx",
    {
      type: "binary",
      encoding: "base64",
      // Compound File signature of password-protected Office files. The viewer diagnoses it before loading an engine.
      content: "0M8R4KGxGuE=",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ],
])

export function createWorkspace(scenario: ChangesScenario) {
  const location = { directory: root }

  const paths = [...contents.keys()]

  const search = (query: string) => paths.filter((path) => path.toLowerCase().includes(query.toLowerCase()))

  let failRead = scenario === "Read error"

  const request = async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input)

    if (url.pathname === "/api/fs/find") {
      const data = search(url.searchParams.get("query") ?? "").map((path) => ({ path, type: "file" }))

      return Response.json({ location, data })
    }

    if (url.pathname === "/api/vcs/diff") {
      if (failRead) {
        failRead = false
        return Response.json({ message: "Could not read the working tree" }, { status: 503 })
      }

      return Response.json({ location, data: scenario === "Clean" ? [] : reviewDiffs })
    }

    if (url.pathname === "/api/session/session-story/diff") return Response.json({ data: [] })

    throw new Error(`Unconfigured workspace fixture: ${url.pathname}`)
  }

  const client = OpenCode.make({
    baseUrl: "https://workspace.invalid",
    fetch: Object.assign(request, { preconnect() {} }),
  })

  const data = createData({ api: () => client, directory: root, event: { on: () => () => {}, listen: () => () => {} } })

  const project = {
    id: "status-checks",
    name: "Status checks",
    worktree: root,
    worktrees: [],
    sandboxes: [],
    vcs: "git" as const,
    time: { created: 1, updated: 1, active: 1 },
  }

  const session: MountedSession = {
    key: "story\nsession-story",
    id: "session-story",
    tab: "story",
    directory: root,
    location,
    pending: false,
    project,
    listedProject: project,
    local: true,
    visit: {},
    background: [],
    server: {
      id: "story",
      name: "Workspace",
      url: "https://workspace.invalid",
      local: true,
      builtin: false,
      compatible: true,
      connected: scenario !== "Offline",
      client,
      data,
    },
  }

  const pathHelpers = createPathHelpers(() => root)

  const tree = createFileTreeStore({
    normalizeDir: pathHelpers.normalizeDir,
    list: async (dir) => {
      const prefix = dir ? `${dir}/` : ""

      const names = new Set(
        paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split("/")[0]!),
      )

      return Array.from(names)
        .sort()
        .map((name): FileNode => {
          const path = `${prefix}${name}`

          return {
            path,
            name,
            type: contents.has(path) ? "file" : "directory",
            absolute: `${root}/${path}`,
            ignored: false,
          }
        })
    },
    onError: (message) => {
      throw new Error(message)
    },
  })

  const [selections, setSelections] = createStore<{ [path: string]: LineRange | null | undefined }>({})

  const file: Files = {
    root,
    ready: () => true,
    resolve: pathHelpers.normalize,
    absolute: pathHelpers.absolute,
    get(path) {
      const content = contents.get(path)

      return { path, name: path.split("/").pop() ?? path, loaded: !!content, notFound: !content, content }
    },
    sync: async () => {},
    unwatch() {},
    missing: (path) => !contents.has(path),
    exists: async (path) => contents.has(path),
    search: async (query) => search(query),
    selection: { get: (path) => selections[path], set: (path, range) => setSelections(path, range) },
    scroll: { get: () => ({}), set() {} },
    tree: {
      list: tree.children,
      state: tree.dirState,
      sync: tree.listDir,
      expand: tree.expandDir,
      collapse: tree.collapseDir,
    },
  }

  const [comments, setComments] = createStore<Comment[]>([
    {
      id: "comment-1",
      time: 1,
      file: reviewDiffs[0]!.file,
      selection: { start: 2, end: 2, side: "additions" },
      comment: "Does this match the label in the check results?",
    },
  ])

  const [focus, setFocus] = createSignal<ReturnType<Comments["focus"]["current"]>>(null)

  let sequence = 1

  const screen: SessionScreen = {
    file,
    comment: {
      list: (path) => (path ? comments.filter((item) => item.file === path) : comments),
      add(input) {
        const time = ++sequence

        const comment = { ...input, id: `comment-${time}`, time }

        setComments(comments.length, comment)
        setFocus({ file: input.file, id: comment.id })

        return comment
      },
      update: (id, text) => setComments((item) => item.id === id, "comment", text),
      remove: (id) => setComments((items) => items.filter((item) => item.id !== id)),
      focus: { current: focus, set: setFocus },
      active: { current: focus, set: setFocus },
    },
    composer: {
      text: () => "",
      setText() {},
      insert() {},
      model: () => undefined,
      setModel: () => false,
      setVariant: () => false,
      attach() {},
      quotable: () => false,
      focus() {},
      update() {},
      detach() {},
      focused: () => false,
    },
  }

  return { session, screen }
}
