import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { createMemo, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { resolveApiErrorMessage } from "@/utils/pr-errors"
import type { ReviewThread } from "@opencode-ai/sdk/v2"

export function AddressCommentsDialog() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const prompt = usePrompt()
  const language = useLanguage()

  const vcs = createMemo(() => sync.data.vcs)
  const pr = createMemo(() => vcs()?.pr)
  const github = createMemo(() => vcs()?.github)

  const [store, setStore] = createStore({
    loading: true,
    error: undefined as string | undefined,
    threads: [] as ReviewThread[],
    selected: {} as Record<string, boolean>,
    instructions: "",
  })

  onMount(async () => {
    try {
      const result = await sdk.client.vcs.pr.comments({ directory: sdk.directory })
      const data = result.data
      if (!data) {
        setStore("error", "No response from server")
        setStore("loading", false)
        return
      }
      const selected: Record<string, boolean> = {}
      for (const thread of data.threads) {
        selected[thread.id] = true
      }
      setStore({
        threads: data.threads,
        selected,
        loading: false,
      })
    } catch (e: unknown) {
      if (import.meta.env.DEV) console.error("Fetch comments error:", e)
      setStore("error", resolveApiErrorMessage(e, "Failed to fetch review comments", (k) => language.t(k as Parameters<typeof language.t>[0])))
      setStore("loading", false)
    }
  })

  const selectedCount = createMemo(() => Object.values(store.selected).filter(Boolean).length)
  const allSelected = createMemo(() => store.threads.length > 0 && selectedCount() === store.threads.length)

  const toggleAll = () => {
    const next = !allSelected()
    const updated: Record<string, boolean> = {}
    for (const thread of store.threads) {
      updated[thread.id] = next
    }
    setStore("selected", updated)
  }

  const toggleThread = (id: string) => {
    setStore("selected", id, !store.selected[id])
  }

  const handleSubmit = () => {
    const prNumber = pr()?.number
    const repo = github()?.repo
    const owner = repo?.owner ?? ""
    const repoName = repo?.name ?? ""

    const selectedThreads = store.threads.filter((t) => store.selected[t.id])

    let text = `Address the following unresolved review comments on PR #${prNumber}.\n\n`
    text += `## Comments to Address\n\n`

    for (const thread of selectedThreads) {
      if (thread.comments.length === 0) continue
      text += `### File: ${thread.path}${thread.line ? ` (line ${thread.line})` : ""}\n`
      for (const comment of thread.comments) {
        text += `**@${comment.author}** (comment ID: ${comment.id}): ${comment.body}\n`
      }
      text += "\n"
    }

    text += `## Instructions\n\n`
    text += `1. Read each comment above and decide whether to fix it or intentionally skip it\n`
    text += `2. For fixes: make the code change\n`
    text += `3. For skips: explain the design rationale in your reply\n`
    text += `4. After addressing all comments, reply to each one on GitHub using the comment ID shown above:\n`
    text += `   \`gh api repos/${owner}/${repoName}/pulls/${prNumber}/comments --method POST -f body="<your reply>" -F in_reply_to=<comment ID>\`\n`
    text += `5. Do NOT merge, rebase, or force-push\n`

    if (store.instructions.trim()) {
      text += `\n${store.instructions.trim()}\n`
    }

    dialog.close()
    requestAnimationFrame(() => {
      prompt.set([
        {
          type: "text",
          content: text,
          start: 0,
          end: text.length,
        },
      ])
    })
  }

  return (
    <Dialog title={language.t("pr.comments.title")} size="large" fit>
      <div class="flex flex-col px-5 pb-5 w-full h-full max-h-[85vh]">
        <Show
          when={!store.loading}
          fallback={
            <div class="flex items-center justify-center py-8 shrink-0">
              <Spinner class="size-5 text-icon-weak" />
            </div>
          }
        >
          <Show when={store.error}>
            <div class="flex flex-col items-center gap-2 py-6 shrink-0">
              <Icon name="circle-x" size="medium" class="text-icon-critical-base" />
              <span class="text-13-medium text-text-strong">{language.t("pr.comments.error.title")}</span>
              <span class="text-12-regular text-text-weak text-center max-w-[360px]">{store.error}</span>
            </div>
          </Show>
          <Show when={!store.error}>
            <Show
              when={store.threads.length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 py-6 shrink-0">
                  <Icon name="circle-check" size="medium" class="text-icon-success-base" />
                  <span class="text-13-regular text-text-weak">{language.t("pr.comments.none")}</span>
                </div>
              }
            >
              {/* Header with count and select all toggle */}
              <div class="flex items-center justify-between shrink-0 pb-2">
                <span class="text-12-medium text-text-weak">
                  {store.threads.length === 1
                    ? language.t("pr.comments.count.one")
                    : language.t("pr.comments.count", { count: String(store.threads.length) })}
                </span>
                <button
                  class="text-12-regular text-text-interactive-base hover:text-text-strong cursor-pointer bg-transparent border-none p-0 transition-colors"
                  onClick={toggleAll}
                >
                  {allSelected() ? language.t("pr.comments.select.none") : language.t("pr.comments.select.all")}
                </button>
              </div>

              {/* Comment thread list */}
              <div class="flex flex-col flex-1 overflow-y-auto min-h-[200px] -mx-5 px-5 py-1">
                <For each={store.threads}>
                  {(thread) => {
                    const firstComment = () => thread.comments[0]
                    const replies = () => thread.comments.slice(1)
                    const isChecked = () => !!store.selected[thread.id]

                    return (
                      <div
                        class={`group flex gap-3.5 py-4 border-b border-border-weak-base last:border-b-0 cursor-pointer transition-colors hover:bg-surface-base px-2 rounded-sm border-l-2 ${
                          isChecked() ? "opacity-100 border-l-border-interactive-base" : "opacity-60 border-l-transparent"
                        }`}
                        onClick={() => toggleThread(thread.id)}
                      >
                        <div class="pt-[3px] shrink-0 pointer-events-none">
                          <Checkbox checked={isChecked()} hideLabel>
                            &nbsp;
                          </Checkbox>
                        </div>
                        <div class="flex flex-col gap-1.5 min-w-0 flex-1">
                          {/* File path + line */}
                          <div class="flex items-center gap-1.5">
                            <Icon name="code-lines" size="small" class="text-icon-weak shrink-0" />
                            <span class="text-12-medium text-text-strong truncate">{thread.path}</span>
                            <Show when={thread.line}>
                              <span class="text-12-regular text-text-weak shrink-0">
                                <span class="text-text-weaker">:</span>
                                {thread.line}
                              </span>
                            </Show>
                          </div>

                          {/* First comment (the review comment) */}
                          <Show when={firstComment()}>
                            {(comment) => (
                              <div class="flex flex-col gap-0.5 mt-0.5">
                                <div class="flex items-center justify-between w-full">
                                  <div class="flex items-center gap-1.5">
                                    <span class="text-12-medium text-text-interactive-base">@{comment().author}</span>
                                    {comment().author.includes("bot") && (
                                      <span class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-sm bg-surface-raised-strong text-text-weak">
                                        Bot
                                      </span>
                                    )}
                                  </div>
                                  {(() => {
                                    const g = github()
                                    const p = pr()
                                    const href = g?.repo && p?.number
                                      ? `https://github.com/${g.repo.owner}/${g.repo.name}/pull/${p.number}#discussion_r${comment().id}`
                                      : undefined
                                    return (
                                      <Show when={href}>
                                        {(url) => (
                                          <a
                                            href={url()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            class="text-icon-weak hover:text-text-strong transition-colors shrink-0 cursor-pointer"
                                            title="View on GitHub"
                                          >
                                            <Icon name="square-arrow-top-right" size="small" />
                                          </a>
                                        )}
                                      </Show>
                                    )
                                  })()}
                                </div>
                                <p class="text-12-regular text-text-base m-0 whitespace-pre-wrap break-words line-clamp-4 leading-relaxed mt-0.5">
                                  {comment().body}
                                </p>
                              </div>
                            )}
                          </Show>

                          {/* Reply count */}
                          <Show when={replies().length > 0}>
                            <div class="flex items-center gap-1.5 mt-1.5">
                              <span class="text-11-medium text-text-weaker font-mono">↳</span>
                              <span class="text-11-medium text-text-weak">
                                {replies().length === 1
                                  ? language.t("pr.comments.replies.one")
                                  : language.t("pr.comments.replies.count", { count: String(replies().length) })}
                              </span>
                            </div>
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </div>

              {/* Additional instructions */}
              <div class="flex flex-col gap-1.5 shrink-0 pt-5 pb-2">
                <label class="text-12-medium text-text-strong">{language.t("pr.comments.instructions")}</label>
                <TextField
                  multiline
                  value={store.instructions}
                  onInput={(e) => setStore("instructions", e.currentTarget.value)}
                  placeholder={language.t("pr.comments.instructions.placeholder")}
                />
              </div>
            </Show>
          </Show>
        </Show>

        {/* Footer */}
        <div class="flex items-center justify-between shrink-0 pt-4 border-t border-border-weak-base mt-2">
          <div class="flex-1 flex items-center gap-3">
            <Show when={store.threads.length > 0 && !store.error}>
              <span class="text-12-regular text-text-weak">
                {language.t("pr.comments.selected", {
                  selected: String(selectedCount()),
                  total: String(store.threads.length),
                })}
              </span>
            </Show>
          </div>
          <div class="flex gap-2 shrink-0">
            <Button variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Show when={store.threads.length > 0 && !store.error}>
              <Button variant="primary" disabled={selectedCount() === 0} onClick={handleSubmit}>
                {language.t("pr.comments.submit")}
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
