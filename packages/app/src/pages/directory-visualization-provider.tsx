import { onCleanup, type JSX, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import {
  VisualizationProvider,
  type VisualizationFollowUpInput,
  type VisualizationFollowUpResult,
} from "@opencode-ai/session-ui/context"
import { type DialogHandle, useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import {
  DialogVisualizationFollowup,
  type VisualizationFollowupDialogResult,
} from "@/components/dialog-visualization-followup"
import { formatServerError } from "@/utils/server-errors"

type LocalSelection = {
  agent?: { name: string }
  model?: { id: string; provider: { id: string } }
  variant?: string
}

type DirectoryVisualizationFollowUpInput = {
  currentSessionID: () => string | undefined
  directory: () => string
  selection: () => LocalSelection | undefined
  isActive: () => boolean
  confirm: (input: VisualizationFollowUpInput) => Promise<VisualizationFollowupDialogResult>
  send: (draft: FollowupDraft, before: () => Promise<boolean> | boolean) => Promise<boolean>
  onError: (error: unknown) => void
}

export type VisualizationDialogStack = {
  push: (element: () => JSX.Element, onClose?: () => void) => DialogHandle
}

export type VisualizationFollowUpRequest = {
  promise: Promise<VisualizationFollowupDialogResult>
  cancel: () => void
}

export function isVisualizationEnabled(platform: "web" | "desktop") {
  return platform === "desktop"
}

export function requestVisualizationFollowUp(
  dialog: VisualizationDialogStack,
  input: VisualizationFollowUpInput,
): VisualizationFollowUpRequest {
  let settled = false
  let resolve: (result: VisualizationFollowupDialogResult) => void = () => undefined
  let handle: DialogHandle | undefined
  const settle = (result: VisualizationFollowupDialogResult) => {
    if (settled) return
    settled = true
    resolve(result)
  }
  const promise = new Promise<VisualizationFollowupDialogResult>((next) => {
    resolve = next
  })
  const close = () => handle?.close()

  handle = dialog.push(
    () => <DialogVisualizationFollowup title={input.title} prompt={input.prompt} onResult={settle} close={close} />,
    () => settle("cancelled"),
  )

  return {
    promise,
    cancel: () => {
      handle?.close()
      settle("cancelled")
    },
  }
}

export function createDirectoryVisualizationFollowUp(input: DirectoryVisualizationFollowUpInput) {
  let pending = false

  return async (followUp: VisualizationFollowUpInput): Promise<VisualizationFollowUpResult> => {
    if (!input.isActive()) return "rejected"
    if (pending) return "rejected"
    if (input.currentSessionID() !== followUp.sessionID) return "rejected"

    pending = true
    try {
      if ((await input.confirm(followUp)) === "cancelled") return "cancelled"
      if (!input.isActive()) return "rejected"
      if (input.currentSessionID() !== followUp.sessionID) return "rejected"

      if (!input.isActive()) return "rejected"
      const selection = input.selection()
      if (!input.isActive()) return "rejected"
      if (!selection?.agent || !selection.model) return "rejected"

      const draft: FollowupDraft = {
        sessionID: followUp.sessionID,
        sessionDirectory: input.directory(),
        prompt: [{ type: "text", content: followUp.prompt, start: 0, end: followUp.prompt.length }],
        context: [],
        agent: selection.agent.name,
        model: { providerID: selection.model.provider.id, modelID: selection.model.id },
        variant: selection.variant,
      }
      const sent = await input.send(draft, () => input.isActive() && input.currentSessionID() === followUp.sessionID)
      return sent ? "sent" : "rejected"
    } catch (error) {
      input.onError(error)
      return "rejected"
    } finally {
      pending = false
    }
  }
}

export function DirectoryVisualizationProvider(props: ParentProps) {
  const params = useParams()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const platform = usePlatform()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  let disposed = false
  let cancel: (() => void) | undefined
  onCleanup(() => {
    disposed = true
    cancel?.()
  })
  const followUp = createDirectoryVisualizationFollowUp({
    currentSessionID: () => params.id,
    directory: () => sdk().directory,
    isActive: () => !disposed,
    selection: () => ({
      agent: local.agent.current(),
      model: local.model.current(),
      variant: local.model.variant.current(),
    }),
    confirm: (input) => {
      const request = requestVisualizationFollowUp(dialog, input)
      cancel = request.cancel
      return request.promise.finally(() => {
        if (cancel === request.cancel) cancel = undefined
      })
    },
    send: (draft, before) =>
      sendFollowupDraft({
        api: sdk().api.session,
        serverSync: serverSync(),
        sync: sync(),
        draft,
        allowCommand: false,
        optimisticBusy: true,
        before: async () => {
          await Promise.resolve()
          return before()
        },
      }),
    onError: (error) => {
      showToast({
        variant: "error",
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: formatServerError(error, language.t),
      })
    },
  })

  return (
    <VisualizationProvider enabled={isVisualizationEnabled(platform.platform)} followUp={followUp}>
      {props.children}
    </VisualizationProvider>
  )
}
