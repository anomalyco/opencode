import { Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { WorkflowInfo } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { normalizePhases } from "./dialog-workflow-helpers"
import type { WorkflowApprovalResult } from "./dialog-workflow-approval-helpers"

export type { WorkflowApprovalResult }

function formatArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args)
  if (entries.length === 0) return "(none)"
  return entries.map(([name, value]) => `${name}=${String(value)}`).join("  ")
}

// Web parity with the TUI DialogWorkflowApproval: shows the workflow's
// description / when-to-use / phases / args plus Yes / Yes-always / View script /
// No. `View script` swaps to a read-only source pager (fetched by NAME via the
// workflow source endpoint, like the TUI) without resolving the promise; Yes / Yes-always / No
// resolve and close. Backdrop/Esc dismissal resolves `cancel` so a start is always
// abort-safe (the single-shot `decide` guards a stray onClose during teardown).
const DialogWorkflowApproval: Component<{
  info: WorkflowInfo
  args: Record<string, unknown>
  decide: (result: WorkflowApprovalResult) => void
}> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()
  const [view, setView] = createSignal<"approval" | "source">("approval")

  const phases = createMemo(() => normalizePhases(props.info))
  const description = createMemo(() => props.info.meta.description)
  const whenToUse = createMemo(() => props.info.meta.whenToUse)

  // Lazily fetched only when the operator opens the source view (parity with the
  // TUI's createResource on showSource). Fetched BY NAME via the workflow source
  // endpoint — the server resolves the bundled string for a builtin and the file
  // text for an on-disk workflow. The previous `file.read({ path: info.path })` was
  // broken for every real workflow (an ABSOLUTE on-disk path errored; a synthetic
  // `builtin:`/`inline:` marker read back empty), so the preview showed nothing. A
  // failed/empty fetch degrades to the noSource message, never throws the view.
  const [source] = createResource(
    () => (view() === "source" ? props.info.name : undefined),
    async (name) => {
      const result = await sdk().client.workflow.source({ name }).catch(() => undefined)
      return result?.data?.source
    },
  )

  return (
    <Dialog
      title={language.t("dialog.workflow.approval.title", { name: props.info.name })}
      description={view() === "approval" ? description() : props.info.path}
    >
      <Show
        when={view() === "approval"}
        fallback={
          <div class="flex flex-col gap-3 px-1">
            <pre class="text-12-regular text-text-strong whitespace-pre-wrap break-words bg-surface-base rounded p-2 max-h-[50vh] overflow-auto">
              {source.loading
                ? language.t("common.loading")
                : (source() ?? language.t("dialog.workflow.approval.noSource"))}
            </pre>
            <div class="flex items-center justify-end">
              <Button variant="secondary" onClick={() => setView("approval")}>
                {language.t("dialog.workflow.approval.back")}
              </Button>
            </div>
          </div>
        }
      >
        <div class="flex flex-col gap-3 px-1">
          <Show when={whenToUse()}>
            <span class="text-12-regular text-text-weak">
              {language.t("dialog.workflow.approval.whenToUse", { text: whenToUse()! })}
            </span>
          </Show>
          <section class="flex flex-col gap-1">
            <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
              {language.t("dialog.workflow.section.phases")}
            </h3>
            <Show
              when={phases().length > 0}
              fallback={
                <span class="text-12-regular text-text-weak">{language.t("dialog.workflow.approval.noPhases")}</span>
              }
            >
              <For each={phases()}>
                {(phase, index) => <span class="text-14-regular text-text-strong">{`${index() + 1}. ${phase}`}</span>}
              </For>
            </Show>
          </section>
          <section class="flex flex-col gap-1">
            <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
              {language.t("dialog.workflow.approval.arguments")}
            </h3>
            <span class="text-12-regular text-text-weak break-words">{formatArgs(props.args)}</span>
          </section>
          <div class="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setView("source")}>
              {language.t("dialog.workflow.approval.view")}
            </Button>
            <Button variant="secondary" onClick={() => props.decide("cancel")}>
              {language.t("dialog.workflow.approval.no")}
            </Button>
            <Button variant="secondary" onClick={() => props.decide("always")}>
              {language.t("dialog.workflow.approval.always")}
            </Button>
            <Button variant="primary" onClick={() => props.decide("once")}>
              {language.t("dialog.workflow.approval.yes")}
            </Button>
          </div>
        </div>
      </Show>
    </Dialog>
  )
}

// Opens the approval dialog and resolves with the user's decision. A single-shot
// `decide` (first call wins) plus the dialog's onClose = decide("cancel") makes a
// backdrop/Esc dismissal resolve `cancel`, so the start is always abort-safe — a
// terminal Yes / Yes-always / No closes the dialog (firing the onClose, which is a
// no-op after `decide` already settled).
export function showWorkflowApproval(
  dialog: ReturnType<typeof useDialog>,
  input: { info: WorkflowInfo; args: Record<string, unknown> },
): Promise<WorkflowApprovalResult> {
  return new Promise<WorkflowApprovalResult>((resolve) => {
    let settled = false
    const decide = (result: WorkflowApprovalResult) => {
      if (settled) return
      settled = true
      resolve(result)
      dialog.close()
    }
    dialog.show(
      () => DialogWorkflowApproval({ info: input.info, args: input.args, decide }),
      () => decide("cancel"),
    )
  })
}
