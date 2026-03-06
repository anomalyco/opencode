import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useSDK } from "@/context/sdk"

const GIT_DIFF_PREFIX = "gitdiff://"

export function gitDiffTab(path: string) {
  return `${GIT_DIFF_PREFIX}${path}`
}

export function pathFromGitDiffTab(tab: string) {
  if (!tab.startsWith(GIT_DIFF_PREFIX)) return undefined
  return tab.slice(GIT_DIFF_PREFIX.length)
}

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

type Kind = "add" | "del" | "mix"

function statusIcon(index: string, working: string): string {
  if (index === "?" && working === "?") return "?"
  if (index === "A" || working === "A") return "A"
  if (index === "D" || working === "D") return "D"
  if (index === "R" || working === "R") return "R"
  return "M"
}

export function createGitStatus() {
  const sdk = useSDK()
  const encodedDirectory = encodeURIComponent(sdk.directory)
  const [status, setStatus] = createSignal<VcsStatus>({ staged: [], unstaged: [], untracked: [] })

  async function fetchJSON<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": encodedDirectory,
        ...sdk.authHeaders,
      },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async function refresh() {
    try {
      const data = await fetchJSON<VcsStatus>(`${sdk.url}/vcs/status`)
      setStatus(data)
    } catch {
      // silently fail
    }
  }

  createEffect(() => {
    refresh()
    const unsub = sdk.event.on("vcs.status.updated" as any, () => refresh())
    const interval = setInterval(refresh, 5000)
    onCleanup(() => {
      unsub()
      clearInterval(interval)
    })
  })

  const allFiles = createMemo(() => {
    const files: FileStatus[] = [...status().staged, ...status().unstaged, ...status().untracked]
    const seen = new Map<string, FileStatus>()
    for (const f of files) if (!seen.has(f.path)) seen.set(f.path, f)
    return [...seen.values()]
  })

  const gitFiles = createMemo(() => allFiles().map((f) => f.path))

  const gitKinds = createMemo(() => {
    const merge = (a: Kind | undefined, b: Kind) => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const out = new Map<string, Kind>()
    for (const f of allFiles()) {
      const icon = statusIcon(f.index, f.working)
      const kind: Kind = icon === "A" || icon === "?" ? "add" : icon === "D" ? "del" : "mix"
      out.set(f.path, kind)

      const parts = f.path.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (dir) out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const count = createMemo(() => gitFiles().length)

  return { gitFiles, gitKinds, count }
}
