import { base64Encode } from "@opencode-ai/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { createMemo, Show, type JSX } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { displayName } from "./helpers"

type T = (key: string, vars?: Record<string, string | number>) => string

type Nav = {
  directory: string
  list: LocalProject[]
  current?: string
  close: (directory: string) => void
  go?: (href: string) => void
  navigate?: (href: string) => void
  open: (directory: string) => Promise<void> | void
}

type Ask = {
  project: LocalProject
  t: T
  show: (cb: () => JSX.Element) => void
  dismiss: () => void
  onClose: (directory: string) => void
  list: (input: { directory: string }) => Promise<{ data?: Session[] | null }>
}

type DialogProps = {
  count: number
  project: LocalProject
  t: T
  onCancel: () => void
  onClose: () => void
}

export function projectCloseBody(count: number, t: T) {
  if (count === 0) return t("dialog.project.close.note")
  if (count === 1) return `${t("dialog.project.close.sessions.one")} ${t("dialog.project.close.note")}`
  return `${t("dialog.project.close.sessions.many", { count })} ${t("dialog.project.close.note")}`
}

export function closeProject(input: Nav) {
  const go = input.go ?? input.navigate
  const index = input.list.findIndex((x) => x.worktree === input.directory)
  const active = input.current === input.directory
  if (index === -1) return
  const next = input.list[index + 1]

  if (!active) {
    input.close(input.directory)
    return
  }

  if (!next) {
    input.close(input.directory)
    go?.("/")
    return
  }

  go?.(`/${base64Encode(next.worktree)}/session`)
  input.close(input.directory)
  queueMicrotask(() => {
    void input.open(next.worktree)
  })
}

async function count(project: LocalProject, list: Ask["list"]) {
  const dirs = [project.worktree, ...(project.sandboxes ?? [])]
  const all = await Promise.all(
    dirs.map((directory) =>
      list({ directory })
        .then((x) => x.data ?? [])
        .catch(() => []),
    ),
  )
  return all.flat().filter((session) => session.time.archived === undefined).length
}

export async function askProjectClose(input: Ask) {
  const total = await count(input.project, input.list)
  input.show(() => (
    <DialogCloseProject
      count={total}
      project={input.project}
      t={input.t}
      onCancel={input.dismiss}
      onClose={() => {
        input.dismiss()
        input.onClose(input.project.worktree)
      }}
    />
  ))
}

export function DialogCloseProject(props: DialogProps) {
  const name = createMemo(() => displayName(props.project))

  return (
    <Dialog title={props.t("dialog.project.close.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {props.t("dialog.project.close.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">{projectCloseBody(props.count, props.t)}</span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={props.onCancel}>
            {props.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={props.onClose}>
            {props.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
