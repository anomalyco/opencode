import { createMemo, createResource, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import type { Issue as IssueType } from "@opencode-ai/sdk/v2"

const statusOrder: IssueType["status"][] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]

const priorityOrder: IssueType["priority"][] = ["urgent", "high", "medium", "low", "none"]

export const SidebarTodo = (props: { directory: Accessor<string> }): JSX.Element => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [refreshKey, setRefreshKey] = createSignal(0)

  const [issues] = createResource(
    () => [props.directory(), refreshKey()] as const,
    async ([directory]) => {
      const res = await sdk.client.issue.list({ directory })
      if (res.error) throw res.error
      return res.data ?? []
    },
  )

  const sorted = createMemo(() => {
    const list = issues.latest ?? []
    return [...list].sort((a, b) => {
      const s = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
      if (s !== 0) return s
      const p = priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
      if (p !== 0) return p
      return a.position - b.position
    })
  })

  const l1 = createMemo(() => sorted().filter((i) => i.level === 0))
  const l2ByParent = createMemo(() => {
    const map = new Map<string, IssueType[]>()
    for (const i of sorted()) {
      if (i.level === 1 && i.parent_id) {
        const list = map.get(i.parent_id) ?? []
        list.push(i)
        map.set(i.parent_id, list)
      }
    }
    return map
  })

  const refetch = () => setRefreshKey((k) => k + 1)

  const addL1 = async () => {
    const title = window.prompt(language.t("sidebar.issue.add"))
    if (!title) return
    const res = await sdk.client.issue.create({
      body_directory: props.directory(),
      issue: { title, content: title, level: 0 },
    })
    if (res.error) {
      showToast({ variant: "error", title: "Failed to create todo" })
      return
    }
    refetch()
  }

  const addL2 = async (parent: IssueType) => {
    const title = window.prompt(language.t("sidebar.issue.add"))
    if (!title) return
    const res = await sdk.client.issue.create({
      body_directory: props.directory(),
      issue: { title, content: title, level: 1, parent_id: parent.id },
    })
    if (res.error) {
      showToast({ variant: "error", title: "Failed to create sub-todo" })
      return
    }
    refetch()
  }

  const cycleStatus = async (issue: IssueType) => {
    const idx = statusOrder.indexOf(issue.status)
    const next = statusOrder[(idx + 1) % statusOrder.length]
    const res = await sdk.client.issue.patchStatus({
      id: issue.id,
      body_directory: props.directory(),
      status: next,
    })
    if (res.error) {
      showToast({ variant: "error", title: "Failed to update status" })
      return
    }
    refetch()
  }

  const removeIssue = async (issue: IssueType) => {
    const res = await sdk.client.issue.delete({ id: issue.id, directory: props.directory() })
    if (res.error) {
      showToast({ variant: "error", title: "Failed to delete todo" })
      return
    }
    refetch()
  }

  return (
    <div class="shrink-0 px-3 py-3 border-t border-border-weak-base">
      <div class="flex items-center gap-2 mb-2">
        <Icon name="task" size="small" class="text-icon-base" />
        <span class="text-14-medium text-text-strong">{language.t("sidebar.issue.title")}</span>
        <div class="flex-1" />
        <Button size="small" variant="ghost" onClick={addL1}>
          {language.t("sidebar.issue.add")}
        </Button>
      </div>

      <Show
        when={!issues.loading && (issues.latest?.length ?? 0) > 0}
        fallback={
          <div class="text-12-regular text-text-base py-2">
            {issues.loading ? "Loading…" : language.t("sidebar.issue.empty")}
          </div>
        }
      >
        <div class="flex flex-col gap-2 max-h-80 overflow-y-auto no-scrollbar">
          <For each={l1()}>
            {(parent) => (
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2 group">
                  <button
                    type="button"
                    class="flex-1 text-left text-13-medium text-text-strong truncate"
                    onClick={() => cycleStatus(parent)}
                    title={parent.title}
                  >
                    {parent.title}
                  </button>
                  <button
                    type="button"
                    class="text-11-regular px-1.5 py-0.5 rounded bg-surface-base text-text-base"
                    onClick={() => addL2(parent)}
                    aria-label="Add sub-todo"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    class="text-11-regular text-text-weak opacity-0 group-hover:opacity-100"
                    onClick={() => removeIssue(parent)}
                    aria-label="Delete"
                  >
                    ×
                  </button>
                </div>
                <Show when={(l2ByParent().get(parent.id) ?? []).length > 0}>
                  <div class="flex flex-col gap-1 pl-4">
                    <For each={l2ByParent().get(parent.id) ?? []}>
                      {(kid) => (
                        <div class="flex items-center gap-2 group">
                          <button
                            type="button"
                            class="flex-1 text-left text-12-regular text-text-base truncate"
                            onClick={() => cycleStatus(kid)}
                            title={kid.title}
                          >
                            {kid.title}
                          </button>
                          <button
                            type="button"
                            class="text-11-regular text-text-weak opacity-0 group-hover:opacity-100"
                            onClick={() => removeIssue(kid)}
                            aria-label="Delete"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
