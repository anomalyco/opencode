import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLayout } from "@/context/layout"
import {
  createMissionControlController,
  type MissionControlDetailTab,
} from "./mission-control/mission-control-controller"
import { MissionControlDetail } from "./mission-control/mission-control-detail"
import { MissionControlInbox } from "./mission-control/mission-control-inbox"
import { missionControlEditor } from "./mission-control/mission-control-keyboard"

export default function MissionControlPage() {
  const [detailTab, setDetailTab] = createSignal<MissionControlDetailTab>("summary")
  const controller = createMissionControlController({ inspect: setDetailTab })
  const layout = useLayout()
  const restoreSidebar = layout.sidebar.opened()
  let root: HTMLDivElement | undefined
  let releaseSidebarTimer: number | undefined
  let compactingSidebar = true

  createEffect(() => {
    if (!compactingSidebar || !layout.sidebar.opened()) return
    layout.sidebar.close()
  })
  onMount(() => {
    releaseSidebarTimer = window.setTimeout(() => {
      releaseSidebarTimer = undefined
      compactingSidebar = false
    }, 500)
    root?.focus({ preventScroll: true })
  })
  onCleanup(() => {
    if (releaseSidebarTimer !== undefined) window.clearTimeout(releaseSidebarTimer)
    if (restoreSidebar) layout.sidebar.open()
  })

  // Shortcuts stay on the page root so approving never requires reaching for the mouse.
  const onKeyDown = (event: KeyboardEvent) => {
    const editor = missionControlEditor(event.target)
    if (editor) {
      if (event.key === "Escape") editor.blur()
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const record = controller.selection.record()

    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault()
      controller.selection.move(1)
      return
    }
    if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault()
      controller.selection.move(-1)
      return
    }
    if (!record) return
    if (event.key === "o") {
      event.preventDefault()
      controller.action.open(record)
      return
    }
    if (!record.permission) return
    if (event.key === "a") {
      event.preventDefault()
      void controller.action.decide(record, "once")
      return
    }
    if (event.key === "d") {
      event.preventDefault()
      void controller.action.decide(record, "reject")
    }
  }

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-component="mission-control"
      class={`
        relative m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)] outline-none
      `}
      onKeyDown={onKeyDown}
    >
      <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-v2-border-border-muted px-5 py-3.5">
        <div class="flex min-w-0 items-center gap-2">
          <h1 class="text-[15px] leading-5 tracking-[-0.08px] text-v2-text-text-strong [font-weight:560]">
            Mission control
          </h1>
          <Show when={controller.data.attention() > 0}>
            <span class="flex shrink-0 items-center gap-1 text-[12px] leading-4 text-v2-state-fg-warning [font-weight:530]">
              <span aria-hidden="true" class="size-1.5 rounded-full bg-v2-state-fg-warning" />
              {`${controller.data.attention()} waiting on you`}
            </span>
          </Show>
          <Show when={controller.data.working() > 0}>
            <span class="shrink-0 text-[12px] leading-4 text-v2-text-text-muted [font-weight:440]">
              {`${controller.data.working()} working`}
            </span>
          </Show>
          <Show when={controller.data.ready() > 0}>
            <span class="shrink-0 text-[12px] leading-4 text-v2-state-fg-success [font-weight:440]">
              {`${controller.data.ready()} ready`}
            </span>
          </Show>
        </div>

        <div class="flex-1" />

        <TextInputV2
          class="w-full max-w-[240px]"
          leadingIcon={<IconV2 name="magnifying-glass" />}
          placeholder="Search agent work"
          aria-label="Search agent work"
          value={controller.filter.query()}
          showClearButton={!!controller.filter.query()}
          onClearClick={() => controller.filter.setQuery("")}
          onInput={(event) => controller.filter.setQuery(event.currentTarget.value)}
        />
      </header>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(420px,460px)_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col border-e border-v2-border-border-muted">
          <MissionControlInbox controller={controller} />
        </div>
        <Show
          when={controller.selection.key()}
          keyed
          fallback={
            <div class="flex min-h-0 items-center justify-center px-6 text-center">
              <p class="max-w-[340px] text-[14px] leading-5 text-v2-text-text-muted [font-weight:440]">
                Select a session to reply or approve without leaving this view.
              </p>
            </div>
          }
        >
          {(_) => (
            <MissionControlDetail
              controller={controller}
              record={controller.selection.record()!}
              tab={detailTab}
              onTabChange={setDetailTab}
            />
          )}
        </Show>
      </div>
    </div>
  )
}
