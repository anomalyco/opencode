import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useSDK } from "@/context/sdk"

type FileStatus = {
  path: string
  index: string
  working: string
}

type VcsStatus = {
  staged: FileStatus[]
  unstaged: FileStatus[]
  untracked: FileStatus[]
}

function createFetchJSON(directory: string, authHeaders: Record<string, string>) {
  const encodedDirectory = encodeURIComponent(directory)
  return async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": encodedDirectory,
        ...authHeaders,
        ...init?.headers,
      },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }
}

function statusIcon(index: string, working: string): string {
  if (index === "?" && working === "?") return "?"
  if (index === "A" || working === "A") return "A"
  if (index === "D" || working === "D") return "D"
  if (index === "R" || working === "R") return "R"
  return "M"
}

function statusColor(icon: string): string {
  switch (icon) {
    case "A":
      return "text-icon-success-base"
    case "D":
      return "text-icon-danger-base"
    case "?":
      return "text-text-weak"
    default:
      return "text-icon-warning-base"
  }
}

export function GitChangesPanel() {
  const sdk = useSDK()
  const fetchJSON = createFetchJSON(sdk.directory, sdk.authHeaders)

  const [status, setStatus] = createSignal<VcsStatus>({ staged: [], unstaged: [], untracked: [] })
  const [commitMessage, setCommitMessage] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [sections, setSections] = createStore({ staged: true, unstaged: true, untracked: true })

  const base = () => sdk.url

  async function refresh() {
    try {
      const data = await fetchJSON<VcsStatus>(`${base()}/vcs/status`)
      setStatus(data)
    } catch {
      // silently fail if endpoint not available yet
    }
  }

  createEffect(() => {
    refresh()
    const unsub = sdk.event.on("vcs.status.updated" as any, () => refresh())
    onCleanup(unsub)
  })

  // Poll as fallback since SSE event type may not be registered yet
  const interval = setInterval(refresh, 5000)
  onCleanup(() => clearInterval(interval))

  const totalChanges = createMemo(
    () => status().staged.length + status().unstaged.length + status().untracked.length,
  )

  async function stageFiles(files: string[]) {
    setLoading(true)
    try {
      await fetchJSON(`${base()}/vcs/stage`, {
        method: "POST",
        body: JSON.stringify({ files }),
      })
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function unstageFiles(files: string[]) {
    setLoading(true)
    try {
      await fetchJSON(`${base()}/vcs/unstage`, {
        method: "POST",
        body: JSON.stringify({ files }),
      })
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function doCommit() {
    const msg = commitMessage().trim()
    if (!msg || status().staged.length === 0) return
    setLoading(true)
    try {
      await fetchJSON(`${base()}/vcs/commit`, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      })
      setCommitMessage("")
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function doPush(force?: boolean) {
    setLoading(true)
    try {
      await fetchJSON(`${base()}/vcs/push`, {
        method: "POST",
        body: JSON.stringify({ force: force ?? false }),
      })
    } finally {
      setLoading(false)
    }
  }

  async function doStash() {
    setLoading(true)
    try {
      await fetchJSON(`${base()}/vcs/stash`, {
        method: "POST",
        body: JSON.stringify({}),
      })
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function doStashPop() {
    setLoading(true)
    try {
      await fetchJSON(`${base()}/vcs/stash/pop`, { method: "POST" })
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-hidden">
      {/* Commit section */}
      <div class="p-2 border-b border-border-base flex flex-col gap-1.5">
        <input
          type="text"
          class="w-full px-2 py-1 text-13-regular bg-surface-base border border-border-base rounded-md
                 placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-border-focus"
          placeholder="Commit message"
          value={commitMessage()}
          onInput={(e) => setCommitMessage(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              doCommit()
            }
          }}
        />
        <div class="flex gap-1">
          <Button
            variant="ghost"
            class="flex-1 h-6 text-12-regular"
            disabled={loading() || !commitMessage().trim() || status().staged.length === 0}
            onClick={doCommit}
          >
            Commit
          </Button>
          <Button variant="ghost" class="h-6 text-12-regular" disabled={loading()} onClick={() => doPush()}>
            Push
          </Button>
          <Button variant="ghost" class="h-6 text-12-regular" disabled={loading()} onClick={doStash}>
            Stash
          </Button>
          <Button variant="ghost" class="h-6 text-12-regular" disabled={loading()} onClick={doStashPop}>
            Pop
          </Button>
        </div>
      </div>

      {/* File sections */}
      <div class="flex-1 overflow-y-auto">
        <Show when={totalChanges() === 0}>
          <div class="p-4 text-13-regular text-text-weak text-center">No changes</div>
        </Show>

        <FileSection
          title="Staged"
          files={status().staged}
          open={sections.staged}
          onToggle={() => setSections("staged", !sections.staged)}
          action="unstage"
          onAction={(file) => unstageFiles([file.path])}
          onActionAll={() => unstageFiles(status().staged.map((f) => f.path))}
          loading={loading()}
        />

        <FileSection
          title="Unstaged"
          files={status().unstaged}
          open={sections.unstaged}
          onToggle={() => setSections("unstaged", !sections.unstaged)}
          action="stage"
          onAction={(file) => stageFiles([file.path])}
          onActionAll={() => stageFiles(status().unstaged.map((f) => f.path))}
          loading={loading()}
        />

        <FileSection
          title="Untracked"
          files={status().untracked}
          open={sections.untracked}
          onToggle={() => setSections("untracked", !sections.untracked)}
          action="stage"
          onAction={(file) => stageFiles([file.path])}
          onActionAll={() => stageFiles(status().untracked.map((f) => f.path))}
          loading={loading()}
        />
      </div>
    </div>
  )
}

function FileSection(props: {
  title: string
  files: FileStatus[]
  open: boolean
  onToggle: () => void
  action: "stage" | "unstage"
  onAction: (file: FileStatus) => void
  onActionAll: () => void
  loading: boolean
}) {
  return (
    <Show when={props.files.length > 0}>
      <div class="border-b border-border-base last:border-b-0">
        <div
          class="w-full flex items-center justify-between px-2 py-1 text-12-medium text-text-weak
                 hover:bg-surface-base-hover cursor-pointer"
          onClick={props.onToggle}
        >
          <div class="flex items-center gap-1">
            <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" />
            <span>
              {props.title} ({props.files.length})
            </span>
          </div>
          <button
            class="text-11-regular text-text-weak hover:text-text-base px-1"
            onClick={(e) => {
              e.stopPropagation()
              props.onActionAll()
            }}
            disabled={props.loading}
          >
            {props.action === "stage" ? "Stage All" : "Unstage All"}
          </button>
        </div>
        <Show when={props.open}>
          <For each={props.files}>
            {(file) => {
              const icon = () => statusIcon(file.index, file.working)
              return (
                <div class="group flex items-center gap-1 px-2 py-0.5 hover:bg-surface-base-hover text-13-regular">
                  <span class={`shrink-0 w-3 text-center text-12-medium ${statusColor(icon())}`}>{icon()}</span>
                  <span class="truncate flex-1 text-text-base" title={file.path}>
                    {file.path}
                  </span>
                  <button
                    class="opacity-0 group-hover:opacity-100 text-11-regular text-text-weak
                           hover:text-text-base px-1 shrink-0"
                    onClick={() => props.onAction(file)}
                    disabled={props.loading}
                  >
                    {props.action === "stage" ? "+" : "-"}
                  </button>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </Show>
  )
}

export function GitChangesBadge() {
  const sdk = useSDK()
  const fetchJSON = createFetchJSON(sdk.directory, sdk.authHeaders)
  const [count, setCount] = createSignal(0)

  async function refresh() {
    try {
      const data = await fetchJSON<VcsStatus>(`${sdk.url}/vcs/status`)
      setCount(data.staged.length + data.unstaged.length + data.untracked.length)
    } catch {
      setCount(0)
    }
  }

  createEffect(() => {
    refresh()
    const unsub = sdk.event.on("vcs.status.updated" as any, () => refresh())
    onCleanup(unsub)
  })

  const interval = setInterval(refresh, 10000)
  onCleanup(() => clearInterval(interval))

  return (
    <Show when={count() > 0}>
      <span class="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-surface-warning-base text-11-medium text-text-base">
        {count()}
      </span>
    </Show>
  )
}
