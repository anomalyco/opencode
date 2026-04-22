import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { MemoryStrip } from "@opencode-ai/ui-team/memory-strip"
import { useLanguage } from "@/context/language"
import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

function openSessionMemory(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  if (!args.view.reviewPanel.opened()) args.view.reviewPanel.open()
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  args.tabs.open("memory")
  args.tabs.setActive("memory")
}

type Area = "project_rules" | "atlas_private" | "feature_memory" | "lessons"

function areaIcon(area: Area) {
  if (area === "project_rules") return "checklist" as const
  if (area === "atlas_private") return "brain" as const
  if (area === "feature_memory") return "file-tree" as const
  return "review" as const
}

const AREAS: Area[] = ["project_rules", "atlas_private", "feature_memory", "lessons"]

export function SessionMemoryUsage(props: { variant?: "strip" | "icon" } = {}) {
  const sync = useSync()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const { params, tabs, view } = useSessionLayout()
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
    hasMemory: () => true,
  })

  const counts = createMemo(() => ({
    project_rules: sync.data.memory_entry.filter((item) => item.area === "project_rules").length,
    atlas_private: sync.data.memory_entry.filter((item) => item.area === "atlas_private").length,
    feature_memory: sync.data.memory_entry.filter((item) => item.area === "feature_memory").length,
    lessons: sync.data.memory_entry.filter((item) => item.area === "lessons").length,
  }))
  const total = createMemo(
    () => counts().project_rules + counts().atlas_private + counts().feature_memory + counts().lessons,
  )
  const latest = createMemo(() => {
    const item = sync.data.memory_activity[0]
    if (!item?.memory_id) return item
    const hit = sync.data.memory_entry.find((entry) => entry.id === item.memory_id)
    if (!hit || hit.ui_locale !== language.locale() || !hit.title_ui) return item
    return { ...item, title: hit.title_ui }
  })

  const openMemory = () => {
    if (!params.id) return
    openSessionMemory({
      view: view(),
      layout,
      tabs: tabs(),
    })
  }

  if (props.variant === "icon") {
    return <MemoryIcon counts={counts()} total={total()} latest={latest()} onClick={openMemory} lang={language} />
  }

  return (
    <MemoryStrip counts={counts()} latest={latest()} open={tabState.memoryOpen()} onOpen={openMemory} />
  )
}

function MemoryIcon(props: {
  counts: Record<Area, number>
  total: number
  latest?: { id: string; effect: string; area?: Area }
  onClick: () => void
  lang: ReturnType<typeof useLanguage>
}) {
  // Activity flash effect (2.4s)
  const [fx, setFx] = createSignal<string | undefined>()
  let fxTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    const item = props.latest
    if (!item?.id) return
    if (fxTimer) clearTimeout(fxTimer)
    setFx(item.effect)
    fxTimer = setTimeout(() => {
      fxTimer = undefined
      setFx(undefined)
    }, 2400)
  })

  // Count change pulse effect (2s)
  const [pulse, setPulse] = createSignal(false)
  let pulseTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    const t = props.total
    if (!t) return
    if (pulseTimer) clearTimeout(pulseTimer)
    setPulse(true)
    pulseTimer = setTimeout(() => {
      pulseTimer = undefined
      setPulse(false)
    }, 2000)
  })

  onCleanup(() => {
    if (fxTimer) clearTimeout(fxTimer)
    if (pulseTimer) clearTimeout(pulseTimer)
  })

  const tooltipContent = () => (
    <div data-component="memory-icon-tooltip">
      <div data-slot="memory-icon-tooltip-row" data-variant="total">
        <span>{props.lang.t("ui.memory.icon.tooltip.total")}</span>
        <span data-slot="memory-icon-tooltip-value">{props.total}</span>
      </div>
      <div data-slot="memory-icon-tooltip-sep" />
      {AREAS.map((area) => (
        <div data-slot="memory-icon-tooltip-row">
          <span>
            {props.lang.t(
              `ui.memory.area.${area === "project_rules" ? "projectRules" : area === "atlas_private" ? "atlasPrivate" : area === "feature_memory" ? "featureMemory" : "lessons"}`,
            )}
          </span>
          <span data-slot="memory-icon-tooltip-value">{props.counts[area]}</span>
        </div>
      ))}
    </div>
  )

  return (
    <Tooltip placement="bottom" value={tooltipContent()}>
      <button
        type="button"
        data-component="memory-icon"
        data-effect={fx()}
        data-pulse={pulse() ? "true" : undefined}
        onClick={props.onClick}
        aria-label={props.lang.t("ui.memory.widget.open")}
      >
        <span data-slot="memory-icon-brain">
          <Icon name="brain" size="small" />
        </span>
        <span data-slot="memory-icon-sep" aria-hidden="true" />
        <span data-slot="memory-icon-count" data-area="total">
          {props.total}
        </span>
      </button>
    </Tooltip>
  )
}
