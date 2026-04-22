import "./memory-system.css"

import { Tooltip } from "../../../ui/src/components/tooltip"
import { Icon } from "../../../ui/src/components/icon"
import { TextShimmer } from "../../../ui/src/components/text-shimmer"
import { useI18n } from "../../../ui/src/context/i18n"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { memoryAreaText } from "./memory-helpers"

export type MemoryStripArea = "project_rules" | "atlas_private" | "lessons" | "feature_memory"

export type MemoryStripActivity = {
  id: string
  memory_id?: string
  effect: "added" | "updated" | "removed" | "read"
  action: "read" | "write" | "promote" | "archive" | "remove" | "validate"
  area?: MemoryStripArea
  actor: string
  title?: string
  count?: number
  time: number
}

export type MemoryStripProps = {
  counts: Record<MemoryStripArea, number>
  latest?: MemoryStripActivity
  open?: boolean
  onOpen?: () => void
}

function icon(area: MemoryStripArea) {
  if (area === "project_rules") return "checklist" as const
  if (area === "atlas_private") return "brain" as const
  if (area === "feature_memory") return "file-tree" as const
  return "review" as const
}

function help(i18n: ReturnType<typeof useI18n>, area: MemoryStripArea) {
  if (area === "project_rules") return i18n.t("ui.memory.area.projectRulesHelp")
  if (area === "atlas_private") return i18n.t("ui.memory.area.atlasPrivateHelp")
  if (area === "feature_memory") return i18n.t("ui.memory.area.featureMemoryHelp")
  return i18n.t("ui.memory.area.lessonsHelp")
}

function since(locale: string, value?: number) {
  if (!value) return ""
  const diff = value - Date.now()
  const abs = Math.abs(diff)
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (abs < 60_000) return fmt.format(Math.round(diff / 1000), "second")
  if (abs < 3_600_000) return fmt.format(Math.round(diff / 60_000), "minute")
  if (abs < 86_400_000) return fmt.format(Math.round(diff / 3_600_000), "hour")
  return fmt.format(Math.round(diff / 86_400_000), "day")
}

function label(i18n: ReturnType<typeof useI18n>, latest?: MemoryStripActivity) {
  if (!latest) return i18n.t("ui.memory.widget.idle")
  if (latest.effect === "read" && typeof latest.count === "number") {
    return i18n.t("ui.memory.widget.activity.readCount", {
      count: String(latest.count),
      actor: latest.actor,
    })
  }
  if (latest.effect === "added") {
    return i18n.t("ui.memory.widget.activity.added", {
      title: latest.title ?? i18n.t("ui.memory.result"),
      actor: latest.actor,
    })
  }
  if (latest.effect === "updated") {
    return i18n.t("ui.memory.widget.activity.updated", {
      title: latest.title ?? i18n.t("ui.memory.result"),
      actor: latest.actor,
    })
  }
  if (latest.effect === "removed") {
    return i18n.t("ui.memory.widget.activity.removed", {
      title: latest.title ?? i18n.t("ui.memory.result"),
      actor: latest.actor,
    })
  }
  return i18n.t("ui.memory.widget.idle")
}

export function MemoryStrip(props: MemoryStripProps) {
  const i18n = useI18n()
  const latest = createMemo(() => props.latest)
  const [fx, setFx] = createSignal<MemoryStripActivity["effect"] | undefined>()
  let timer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    const item = latest()
    if (!item?.id) return
    if (timer) clearTimeout(timer)
    setFx(item.effect)
    timer = setTimeout(() => {
      timer = undefined
      setFx(undefined)
    }, 1400)
  })

  onCleanup(() => {
    if (!timer) return
    clearTimeout(timer)
  })

  const parts = createMemo(() =>
    (["project_rules", "atlas_private", "feature_memory", "lessons"] as const).map((area) => ({
      area,
      count: props.counts[area] ?? 0,
    })),
  )
  const total = createMemo(() => parts().reduce((sum, p) => sum + p.count, 0))
  const active = createMemo(() => latest()?.area)
  const clickable = createMemo(() => !!props.onOpen)

  return (
    <button
      type="button"
      data-component="memory-strip"
      data-open={props.open ? "true" : undefined}
      data-clickable={clickable() ? "true" : undefined}
      data-effect={fx()}
      data-area={active()}
      onClick={() => props.onOpen?.()}
      aria-label={i18n.t("ui.memory.widget.open")}
    >
      <div data-slot="memory-strip-head">
        <span data-slot="memory-strip-icon-wrap">
          <Icon name="brain" size="small" />
        </span>
        <div data-slot="memory-strip-copy">
          <div data-slot="memory-strip-top">
            <span data-slot="memory-strip-title">{i18n.t("ui.memory.widget.title")}</span>
            <span data-slot="memory-strip-live">{i18n.t("ui.memory.widget.live")}</span>
            <Show when={total() > 0}>
              <span data-slot="memory-strip-badge">{total()}</span>
            </Show>
          </div>
          <span data-slot="memory-strip-meta">{i18n.t("ui.memory.widget.summary")}</span>
        </div>
      </div>

      <div data-slot="memory-strip-counts">
        <For each={parts()}>
          {(item, idx) => (
            <>
              <Tooltip value={help(i18n, item.area)} placement="top" gutter={6}>
                <span data-slot="memory-strip-count" data-active={active() === item.area ? "true" : undefined}>
                  <Icon name={icon(item.area)} size="small" />
                  <span>{item.count}</span>
                </span>
              </Tooltip>
              <Show when={idx() < parts().length - 1}>
                <span data-slot="memory-strip-sep" aria-hidden="true">
                  |
                </span>
              </Show>
            </>
          )}
        </For>
      </div>

      <div data-slot="memory-strip-activity">
        <TextShimmer as="span" text={label(i18n, latest())} active={fx() === "read"} class="min-w-0 truncate" />
        <Show when={latest()?.time}>
          <span data-slot="memory-strip-time">{since(i18n.locale(), latest()?.time)}</span>
        </Show>
      </div>

      <div data-slot="memory-strip-hints">
        <For each={parts()}>
          {(item) => (
            <span data-slot="memory-strip-hint">
              <Icon name={icon(item.area)} size="small" />
              <span>{memoryAreaText(i18n, item.area)}</span>
            </span>
          )}
        </For>
      </div>
    </button>
  )
}
