import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { WorkflowInfo } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { selectedForeground, useTheme } from "../context/theme"
import { type DialogContext } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { getScrollAcceleration } from "../util/scroll"
import { useBindings } from "../keymap"
import {
  createApprovalStack,
  type ApprovalStackController,
  type WorkflowApprovalResult,
} from "./dialog-workflow-approval-helpers"
import { phaseTitles } from "./dialog-workflow-helpers"

export type { WorkflowApprovalResult }

type Option = {
  id: WorkflowApprovalResult | "source"
  label: string
}

// Order matters: it is both the visual order and the up/down navigation order.
const OPTIONS: Option[] = [
  { id: "once", label: "Yes" },
  { id: "always", label: "Yes, always" },
  { id: "source", label: "View script" },
  { id: "cancel", label: "No" },
]

function formatArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args)
  if (entries.length === 0) return "(none)"
  return entries.map(([name, value]) => `${name}=${String(value)}`).join("  ")
}

export function DialogWorkflowApproval(props: {
  info: WorkflowInfo
  args: Record<string, unknown>
  // Reserved `budget=` cost cap (USD) extracted from the args; shown so the user
  // approves the cap together with the start.
  budget?: number
  controller: ApprovalStackController
}) {
  const { theme } = useTheme()
  const [active, setActive] = createSignal(0)

  // Item 9: phases may be structured entries (string | {title, …}); normalize to
  // the title strings so a structured phase never renders as "[object Object]".
  const phases = createMemo(() => phaseTitles(props.info.meta.phases))
  const description = createMemo(() => props.info.meta.description)
  const whenToUse = createMemo(() => props.info.meta.whenToUse)

  function move(delta: number) {
    setActive((prev) => (prev + delta + OPTIONS.length) % OPTIONS.length)
  }

  function choose(option: Option) {
    // "View script" swaps in the read-only source pager via the controller, which
    // uses notifyClose:false so merely previewing the script never resolves the
    // start promise (the approval item's onClose = decide("cancel") must not fire
    // during the swap). The terminal Yes/Yes-always/No paths resolve and tear the
    // stack down.
    if (option.id === "source") {
      props.controller.showSource()
      return
    }
    props.controller.commit(option.id)
  }

  useBindings(() => ({
    bindings: [
      { key: "up,k", desc: "Previous option", group: "Workflow approval", cmd: () => move(-1) },
      { key: "down,j", desc: "Next option", group: "Workflow approval", cmd: () => move(1) },
      {
        key: "return",
        desc: "Choose option",
        group: "Workflow approval",
        cmd: () => choose(OPTIONS[active()]),
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          {/* Item 9: title with the workflow's DISPLAY name (meta.name); the
              command/file name reads as a muted subtitle when it differs. */}
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Start workflow: {props.info.meta.name}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => choose({ id: "cancel", label: "No" })}>
            esc
          </text>
        </box>
        <Show when={props.info.meta.name !== props.info.name}>
          <text fg={theme.textMuted}>{`/${props.info.name} — ${props.info.path}`}</text>
        </Show>
      </box>

      <Show when={description()}>
        <text fg={theme.textMuted}>{description()}</text>
      </Show>

      <Show when={whenToUse()}>
        <text fg={theme.textMuted}>{`When to use: ${whenToUse()}`}</text>
      </Show>

      <box flexDirection="column">
        <text fg={theme.text}>Phases:</text>
        <Show when={phases().length} fallback={<text fg={theme.textMuted}> (none declared)</text>}>
          <For each={phases()}>
            {(phase, index) => <text fg={theme.textMuted}>{`  ${index() + 1}. ${phase}`}</text>}
          </For>
        </Show>
      </box>

      <box flexDirection="column">
        <text fg={theme.text}>Arguments:</text>
        <text fg={theme.textMuted}>{`  ${formatArgs(props.args)}`}</text>
      </box>

      <Show when={props.budget !== undefined}>
        <text fg={theme.textMuted}>{`Budget: $${props.budget} (cost cap for this run)`}</text>
      </Show>

      <box flexDirection="column" paddingBottom={1}>
        <For each={OPTIONS}>
          {(option, index) => {
            const isActive = createMemo(() => index() === active())
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive() ? theme.primary : undefined}
                onMouseDown={() => setActive(index())}
                onMouseUp={() => choose(option)}
              >
                <text fg={isActive() ? selectedForeground(theme) : theme.textMuted}>
                  {`${isActive() ? "›" : " "} ${option.label}`}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

// Read-only pager for a workflow's source. The source is fetched lazily through
// the workflow source endpoint BY NAME (`sdk.client.workflow.source`) — the server
// resolves the bundled string for a builtin and the file text for an on-disk
// workflow. The previous `file.read({ path: info.path })` was broken for every
// real workflow: an ABSOLUTE on-disk path errored and a synthetic `builtin:`/
// `inline:` marker read back empty, so the preview showed nothing. Works against a
// remote server too. A failed/empty fetch degrades to "No source recorded." rather
// than throwing the pager.
function DialogWorkflowSource(props: { info: WorkflowInfo; onBack: () => void }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined

  const [source] = createResource(async () => {
    const result = await sdk.client.workflow.source({ name: props.info.name }).catch(() => undefined)
    if (!result || result.error || !result.data) return undefined
    return result.data.source
  })

  useBindings(() => ({
    bindings: [
      { key: "escape", desc: "Back to approval", group: "Workflow source", cmd: () => props.onBack() },
      { key: "b", desc: "Back to approval", group: "Workflow source", cmd: () => props.onBack() },
      { key: "up,k", desc: "Scroll up", group: "Workflow source", cmd: () => scroll?.scrollBy(-1) },
      { key: "down,j", desc: "Scroll down", group: "Workflow source", cmd: () => scroll?.scrollBy(1) },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height - 1}
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.info.name} — {props.info.path}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onBack()}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
        scrollAcceleration={getScrollAcceleration()}
      >
        <text fg={theme.textMuted} wrapMode="none">
          {source.loading ? "Loading…" : (source() ?? "No source recorded.")}
        </text>
      </scrollbox>
      <text fg={theme.textMuted}>[Esc]/[B] Back to approval</text>
    </box>
  )
}

// Opens the approval dialog and resolves with the user's decision. Esc / backdrop
// dismissal resolves "cancel" so the start is always abort-safe. The stack
// choreography (swap to source pager and back without prematurely resolving) lives
// in createApprovalStack so it can be unit-tested against a fake dialog.
DialogWorkflowApproval.show = (
  dialog: DialogContext,
  input: { info: WorkflowInfo; args: Record<string, unknown>; budget?: number },
) => {
  return new Promise<WorkflowApprovalResult>((resolve) => {
    const controller = createApprovalStack({
      dialog,
      resolve,
      renderApproval: (controller) => () => (
        <DialogWorkflowApproval info={input.info} args={input.args} budget={input.budget} controller={controller} />
      ),
      renderSource: (controller) => () => <DialogWorkflowSource info={input.info} onBack={() => controller.back()} />,
    })
    controller.showApproval()
  })
}
