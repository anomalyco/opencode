import { Component, createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useServerSync } from "@/context/server-sync"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { showToast } from "@/utils/toast"
import { extractPromptFromParts } from "@/utils/prompt"
import type { TextPart as SDKTextPart } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { Worktree as WorktreeState } from "@/utils/worktree"
import {
  ExploreForkError,
  exploreForkErrorMessage,
  runExploreFork,
  type ExploreForkTarget,
} from "./dialog-fork-flow"

interface ForkableMessage {
  id: string
  text: string
  time: string
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogFork: Component<{ mode?: "message" | "worktree" }> = (props) => {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()

  const messages = createMemo((): ForkableMessage[] => {
    const sessionID = params.id
    if (!sessionID) return []

    const msgs = sync.data.message[sessionID] ?? []
    const result: ForkableMessage[] = []

    for (const message of msgs) {
      if (message.role !== "user") continue

      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((x): x is SDKTextPart => x.type === "text" && !x.synthetic && !x.ignored)
      if (!textPart) continue

      result.push({
        id: message.id,
        text: textPart.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  const targets = createMemo((): Array<ExploreForkTarget & { id: string; label: string }> => {
    return [
      { id: "create", type: "create", label: language.t("session.new.worktree.create") },
      { id: "current", type: "current", directory: sdk.directory, label: language.t("dialog.fork.target.current") },
    ]
  })

  const handleSelect = (item: ForkableMessage | undefined) => {
    if (!item) return

    const sessionID = params.id
    if (!sessionID) return

    const parts = sync.data.part[item.id] ?? []
    const restored = extractPromptFromParts(parts, {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })
    const dir = base64Encode(sdk.directory)

    sdk.client.session
      .fork({ sessionID, messageID: item.id })
      .then((forked) => {
        if (!forked.data) {
          showToast({ title: language.t("common.requestFailed") })
          return
        }
        dialog.close()
        prompt.set(restored, undefined, { dir, id: forked.data.id })
        navigate(`/${dir}/session/${forked.data.id}`)
      })
      .catch((err: unknown) => {
        showToast({ title: language.t("common.requestFailed"), description: exploreForkErrorMessage(err) })
      })
  }

  const handleExploreTarget = (target: ExploreForkTarget | undefined) => {
    const sessionID = params.id
    if (!sessionID || !target) return

    runExploreFork({
      client: sdk.client,
      sourceDirectory: sdk.directory,
      sessionID,
      target,
      createClient: (directory) => sdk.createClient({ directory, throwOnError: true }),
      markWorktreePending: (directory) => WorktreeState.pending(sdk.scope, directory),
      waitForWorktree: async (directory) => {
        const timeoutMs = 5 * 60 * 1000
        const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
          window.setTimeout(() => {
            resolve({ status: "failed", message: language.t("workspace.error.stillPreparing") })
          }, timeoutMs)
        })
        const waited = await Promise.race([WorktreeState.wait(sdk.scope, directory), timeout])
        if (waited.status === "pending") {
          return { status: "failed", message: language.t("workspace.error.stillPreparing") }
        }
        return waited
      },
      syncChild: (directory) => serverSync.child(directory),
    })
      .then((forked) => {
        dialog.close()
        const dir = base64Encode(forked.directory)
        navigate(`/${dir}/session/${forked.sessionID}`)
      })
      .catch((err: unknown) => {
        const title =
          err instanceof ExploreForkError && err.kind === "worktree"
            ? language.t("prompt.toast.worktreeCreateFailed.title")
            : err instanceof ExploreForkError && err.kind === "copy"
              ? language.t("toast.session.fork.copyChangesFailed.title")
              : language.t("common.requestFailed")
        showToast({ title, description: exploreForkErrorMessage(err), variant: "error" })
      })
  }

  if (props.mode === "worktree") {
    return (
      <Dialog title={language.t("command.session.fork.worktree")}>
        <List
          class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          key={(x) => x.id}
          items={targets}
          filterKeys={["label"]}
          onSelect={handleExploreTarget}
        >
          {(item) => (
            <div class="w-full flex items-center gap-2">
              <span class="truncate flex-1 min-w-0 text-left font-normal">{item.label}</span>
            </div>
          )}
        </List>
      </Dialog>
    )
  }

  return (
    <Dialog title={language.t("command.session.fork")}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.fork.empty")}
        key={(x) => x.id}
        items={messages}
        filterKeys={["text"]}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            {item.time && <span class="text-text-weak shrink-0 font-normal">{item.time}</span>}
          </div>
        )}
      </List>
    </Dialog>
  )
}
