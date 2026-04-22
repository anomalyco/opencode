import "./memory-system.css"

import { Button } from "../../../ui/src/components/button"
import { Card, CardDescription, CardTitle } from "../../../ui/src/components/card"
import { Collapsible } from "../../../ui/src/components/collapsible"
import { Icon } from "../../../ui/src/components/icon"
import { IconButton } from "../../../ui/src/components/icon-button"
import { TextField } from "../../../ui/src/components/text-field"
import { Select } from "../../../ui/src/components/select"
import { Tag } from "../../../ui/src/components/tag"
import { Tooltip } from "../../../ui/src/components/tooltip"
import { AnimatedNumber } from "../../../ui/src/components/animated-number"
import { useI18n } from "../../../ui/src/context/i18n"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  memoryAreaText,
  memoryClassText,
  memoryCopy,
  memoryDomainText,
  memoryKindText,
  memoryStatusText,
} from "./memory-helpers"
import type { MemoryStripActivity, MemoryStripArea } from "./memory-strip"
import { TranslationBanner } from "./translation-state"
import { Spinner } from "../../../ui/src/components/spinner"

type Json = Record<string, unknown>

export type MemoryPanelEntry = {
  id: string
  project_id: string
  session_id: string
  area: MemoryStripArea
  class: "rule" | "knowledge" | "evidence" | "artifact"
  kind: string
  domain: string
  title: string
  content: string
  title_ui?: string
  content_ui?: string
  ui_locale?: string
  is_translate?: boolean
  translate_status?: "idle" | "waiting" | "started" | "finished"
  translate_done?: number
  translate_total?: number
  scope?: string
  tags: string[]
  status: "active" | "archived"
  created_by: string
  updated_by: string
  source_id?: string
  payload?: Json
  meta?: Record<string, string | number | boolean | null>
  time: {
    created: number
    updated: number
  }
}

export type MemoryPanelProps = {
  entries?: MemoryPanelEntry[]
  activity?: MemoryStripActivity[]
  translating?: boolean
  onTranslate?: () => void
  onForceTranslate?: () => void
  onStopTranslate?: () => void
  onRemove?: (id: string) => void
  translateError?: {
    message: string
    detail: string
  }
  onClearTranslateError?: () => void
}

function icon(area: MemoryStripArea) {
  if (area === "project_rules") return "checklist" as const
  if (area === "atlas_private") return "brain" as const
  if (area === "feature_memory") return "file-tree" as const
  return "review" as const
}

function classIcon(cls: string) {
  if (cls === "rule") return "shield" as const
  if (cls === "knowledge") return "brain" as const
  if (cls === "evidence") return "eye" as const
  if (cls === "artifact") return "folder" as const
  return "help" as const
}

function statusIcon(status: string) {
  if (status === "active") return "circle-check" as const
  if (status === "archived") return "archive" as const
  return "help" as const
}

function domainIcon(domain: string) {
  if (domain === "security") return "shield" as const
  if (domain === "performance") return "console" as const
  if (domain === "data") return "folder" as const
  if (domain === "frontend") return "code" as const
  return "review" as const
}

function effectIcon(effect?: MemoryStripActivity["effect"]) {
  if (effect === "added") return "arrow-up" as const
  if (effect === "updated") return "branch" as const
  if (effect === "removed") return "circle-ban-sign" as const
  return "magnifying-glass" as const
}

function effectTone(effect?: MemoryStripActivity["effect"]) {
  if (effect === "added") return "success"
  if (effect === "updated") return "brand"
  if (effect === "removed") return "critical"
  return "weak"
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

function pretty(value?: Json | Record<string, string | number | boolean | null>) {
  if (!value) return
  const keys = Object.keys(value)
  if (keys.length === 0) return
  return JSON.stringify(value, null, 2)
}

function clip(value: string, size = 108) {
  if (value.length <= size) return value
  return `${value.slice(0, size - 1)}…`
}

function translationStatus(item: Pick<MemoryPanelEntry, "is_translate" | "translate_status">) {
  if (item.translate_status && item.translate_status !== "idle") return item.translate_status
  if (item.is_translate) return "finished" as const
}

function translationProgress(item: Pick<MemoryPanelEntry, "translate_done" | "translate_total">) {
  const total = item.translate_total
  const done = item.translate_done
  if (!total || total <= 0 || done === undefined) return
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

function translationText(i18n: ReturnType<typeof useI18n>, item: MemoryPanelEntry) {
  const status = translationStatus(item)
  if (!status) return ""
  if (status === "finished") return i18n.t("ui.translation.completed")
  if (status === "started") return i18n.t("ui.translation.started")
  return i18n.t("ui.translation.waiting")
}

function activityText(i18n: ReturnType<typeof useI18n>, item: MemoryStripActivity, title?: string) {
  if (item.effect === "read" && typeof item.count === "number") {
    return i18n.t("ui.memory.widget.activity.readCount", {
      count: String(item.count),
      actor: item.actor,
    })
  }
  if (item.effect === "added") {
    return i18n.t("ui.memory.widget.activity.added", {
      title: title ?? item.title ?? i18n.t("ui.memory.result"),
      actor: item.actor,
    })
  }
  if (item.effect === "updated") {
    return i18n.t("ui.memory.widget.activity.updated", {
      title: title ?? item.title ?? i18n.t("ui.memory.result"),
      actor: item.actor,
    })
  }
  return i18n.t("ui.memory.widget.activity.removed", {
    title: title ?? item.title ?? i18n.t("ui.memory.result"),
    actor: item.actor,
  })
}

function Field(props: { label: string; value?: string }) {
  return (
    <Show when={props.value}>
      <div data-slot="memory-panel-field">
        <span data-slot="memory-panel-field-label">{props.label}</span>
        <span data-slot="memory-panel-field-value">{props.value}</span>
      </div>
    </Show>
  )
}

function Section(props: { title: string; value?: string; mono?: boolean }) {
  return (
    <Show when={props.value}>
      <section data-slot="memory-panel-section">
        <div data-slot="memory-panel-section-title">{props.title}</div>
        <div data-slot="memory-panel-section-body" data-mono={props.mono ? "true" : undefined}>
          {props.value}
        </div>
      </section>
    </Show>
  )
}

const AREA_OPTS = ["all", "project_rules", "atlas_private", "feature_memory", "lessons"] as const
const STATUS_OPTS = ["all", "active", "archived"] as const

export function MemoryPanel(props: MemoryPanelProps) {
  const i18n = useI18n()
  const [state, setState] = createStore({
    query: "",
    area: "all" as "all" | MemoryStripArea,
    domain: "all",
    status: "all" as "all" | "active" | "archived",
    selected: "",
    dismissed: "",
  })

  const entries = createMemo(() => (props.entries ?? []).slice().sort((a, b) => b.time.updated - a.time.updated))
  const activity = createMemo(() => (props.activity ?? []).slice().sort((a, b) => b.time - a.time))
  const activityTitle = (item?: MemoryStripActivity) => {
    if (!item?.memory_id) return item?.title
    const hit = entries().find((entry) => entry.id === item.memory_id)
    if (!hit) return item.title
    return memoryCopy(hit, i18n.locale()).title
  }
  const counts = createMemo(() => ({
    project_rules: entries().filter((item) => item.area === "project_rules").length,
    atlas_private: entries().filter((item) => item.area === "atlas_private").length,
    feature_memory: entries().filter((item) => item.area === "feature_memory").length,
    lessons: entries().filter((item) => item.area === "lessons").length,
  }))

  // Per-area count pulse
  const [pulseArea, setPulseArea] = createSignal<string | undefined>()
  let pulseTimer: ReturnType<typeof setTimeout> | undefined
  const prevCounts = { ...counts() }

  createEffect(() => {
    const c = counts()
    for (const area of ["project_rules", "atlas_private", "feature_memory", "lessons"] as const) {
      if (c[area] !== prevCounts[area]) {
        prevCounts[area] = c[area]
        if (pulseTimer) clearTimeout(pulseTimer)
        setPulseArea(area)
        pulseTimer = setTimeout(() => {
          pulseTimer = undefined
          setPulseArea(undefined)
        }, 1200)
      }
    }
  })
  const domains = createMemo(() => ["all", ...new Set(entries().map((item) => item.domain))])
  const filtered = createMemo(() =>
    entries().filter((item) => {
      const query = state.query.trim().toLowerCase()
      if (state.area !== "all" && item.area !== state.area) return false
      if (state.domain !== "all" && item.domain !== state.domain) return false
      if (state.status !== "all" && item.status !== state.status) return false
      if (!query) return true
      const ui = memoryCopy(item, i18n.locale())
      return [
        ui.title,
        ui.content,
        item.title,
        item.content,
        item.scope ?? "",
        item.domain,
        item.kind,
        item.class,
        ...item.tags,
      ]

        .join(" ")
        .toLowerCase()
        .includes(query)
    }),
  )
  const selected = createMemo(() => filtered().find((item) => item.id === state.selected) ?? filtered()[0])
  const select = (id?: string) => {
    if (!id) return
    setState("selected", id)
  }

  createEffect(() => {
    const item = selected()
    if (!item) {
      if (state.selected) setState("selected", "")
      return
    }
    if (state.selected === item.id) return
    setState("selected", item.id)
  })

  const areaLabel = (v: string): string =>
    v === "all" ? i18n.t("ui.memory.all") : (memoryAreaText(i18n, v as MemoryStripArea) ?? v)

  const statusLabel = (v: string): string =>
    v === "all"
      ? i18n.t("ui.memory.panel.filters.allStatus")
      : (memoryStatusText(i18n, v as "active" | "archived") ?? v)

  const domainLabel = (v: string): string =>
    v === "all" ? i18n.t("ui.memory.panel.filters.allDomains") : (memoryDomainText(i18n, v) ?? v)

  return (
    <div data-component="memory-panel">
      {/* Header */}
      <div data-slot="memory-panel-head">
        <div>
          <div data-slot="memory-panel-title-row">
            <span data-slot="memory-panel-title">{i18n.t("ui.memory.panel.title")}</span>
          </div>
          <div data-slot="memory-panel-subtitle">{i18n.t("ui.memory.panel.description")}</div>
        </div>
        <div data-slot="memory-panel-side">
          <Show when={props.onTranslate}>
            <Button
              size="small"
              variant="secondary"
              disabled={props.translating || entries().length === 0}
              onClick={() => props.onTranslate?.()}
            >
              <Show when={props.translating}>
                <Spinner class="size-3" />
              </Show>
              {props.translating ? i18n.t("ui.memory.panel.translating") : i18n.t("ui.memory.panel.translate")}
            </Button>
          </Show>
          <Show when={props.onForceTranslate}>
            <Button
              size="small"
              variant="secondary"
              disabled={props.translating || entries().length === 0}
              onClick={() => props.onForceTranslate?.()}
            >
              {i18n.t("ui.translation.force")}
            </Button>
          </Show>
          <Show when={props.onStopTranslate}>
            <Button
              size="small"
              variant="secondary"
              disabled={!props.translating}
              onClick={() => props.onStopTranslate?.()}
            >
              {i18n.t("ui.translation.stop")}
            </Button>
          </Show>
          <div data-slot="memory-panel-total" aria-live="polite">
            <AnimatedNumber value={entries().length} />{" "}
            {entries().length === 1 ? i18n.t("ui.memory.entry") : i18n.t("ui.memory.entries")}
          </div>
        </div>
      </div>
      <TranslationBanner
        translating={!!props.translating}
        items={entries()}
        label={i18n.t("ui.memory.panel.translating")}
      />
      <Show when={props.translateError}>
        {(err) => (
          <Card variant="error">
            <CardTitle variant="error">{err().message}</CardTitle>
            <Collapsible>
              <Collapsible.Trigger>
                <span data-slot="memory-panel-error-detail-toggle">{i18n.t("ui.toolErrorCard.failed")}</span>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <CardDescription>{err().detail}</CardDescription>
              </Collapsible.Content>
            </Collapsible>
            <Show when={props.onClearTranslateError}>
              <Tooltip value={i18n.t("ui.common.close")} placement="top">
                <IconButton
                  icon="close"
                  size="small"
                  variant="ghost"
                  onClick={() => props.onClearTranslateError?.()}
                  aria-label={i18n.t("ui.common.close")}
                />
              </Tooltip>
            </Show>
          </Card>
        )}
      </Show>

      {/* Summary Cards — area quick-filter */}
      <div data-slot="memory-panel-summary">
        <For
          each={
            [
              ["project_rules", counts().project_rules],
              ["atlas_private", counts().atlas_private],
              ["feature_memory", counts().feature_memory],
              ["lessons", counts().lessons],
            ] as const
          }
        >
          {([area, count]) => (
            <button
              type="button"
              data-slot="memory-panel-summary-card"
              data-active={state.area === area ? "true" : undefined}
              data-pulse={pulseArea() === area ? "true" : undefined}
              onClick={() => setState("area", state.area === area ? "all" : area)}
              aria-pressed={state.area === area}
              aria-label={`${memoryAreaText(i18n, area)}: ${count}`}
            >
              <span data-slot="memory-panel-summary-icon">
                <Icon name={icon(area)} size="small" />
              </span>
              <span data-slot="memory-panel-summary-copy">
                <span data-slot="memory-panel-summary-name">{memoryAreaText(i18n, area)}</span>
                <span data-slot="memory-panel-summary-value">
                  <AnimatedNumber value={count} />
                </span>
              </span>
            </button>
          )}
        </For>
      </div>

      {/* Latest Activity Banner */}
      <Show when={activity().length > 0 && activity()[0]?.id !== state.dismissed}>
        <div data-slot="memory-panel-activity-banner" data-tone={effectTone(activity()[0]?.effect)} aria-live="polite">
          <button
            type="button"
            data-clickable={activity()[0]?.memory_id ? "true" : undefined}
            onClick={() => select(activity()[0]?.memory_id)}
            aria-label={activityText(i18n, activity()[0], activityTitle(activity()[0]))}
          >
            <span data-slot="memory-panel-activity-icon">
              <Icon name={effectIcon(activity()[0]?.effect)} size="small" />
            </span>
            <div data-slot="memory-panel-activity-copy">
              <span data-slot="memory-panel-activity-text">
                {activityText(i18n, activity()[0], activityTitle(activity()[0]))}
              </span>
              <span data-slot="memory-panel-activity-meta">
                {activity()[0]?.area
                  ? memoryAreaText(i18n, activity()[0].area as MemoryStripArea)
                  : i18n.t("ui.memory.all")}{" "}
                · {since(i18n.locale(), activity()[0]?.time)}
              </span>
            </div>
          </button>
          <Tooltip value={i18n.t("ui.memory.panel.activity.dismiss")} placement="top">
            <IconButton
              icon="close"
              size="small"
              variant="ghost"
              onClick={() => setState("dismissed", activity()[0]?.id ?? "")}
              aria-label={i18n.t("ui.memory.panel.activity.dismiss")}
            />
          </Tooltip>
        </div>
      </Show>

      {/* Search + Filters */}
      <div data-slot="memory-panel-controls">
        <TextField
          value={state.query}
          onInput={(event) => setState("query", event.currentTarget.value)}
          label={i18n.t("ui.memory.query")}
          placeholder={i18n.t("ui.memory.panel.searchPlaceholder")}
          class="w-full"
        />
        <div data-slot="memory-panel-filter-row">
          <Select
            options={[...AREA_OPTS]}
            current={state.area}
            value={(x) => x}
            label={areaLabel}
            onSelect={(v) => setState("area", (v ?? "all") as typeof state.area)}
            size="small"
            variant="ghost"
          />
          <Select
            options={[...STATUS_OPTS]}
            current={state.status}
            value={(x) => x}
            label={statusLabel}
            onSelect={(v) => setState("status", (v ?? "all") as typeof state.status)}
            size="small"
            variant="ghost"
          />
          <Select
            options={domains()}
            current={state.domain}
            value={(x) => x}
            label={domainLabel}
            onSelect={(v) => setState("domain", v ?? "all")}
            size="small"
            variant="ghost"
          />
        </div>
      </div>

      {/* Entries List + Detail Panel */}
      <div data-slot="memory-panel-body">
        <ul data-slot="memory-panel-list" aria-label="Memory entries">
          <Show
            when={filtered().length > 0}
            fallback={
              <li data-slot="memory-panel-empty-card">
                <span data-slot="memory-panel-empty-icon">
                  <Icon name="brain" size="small" />
                </span>
                <div data-slot="memory-panel-empty-copy">
                  <div data-slot="memory-panel-empty-title">{i18n.t("ui.memory.empty.list")}</div>
                  <div data-slot="memory-panel-empty-body">{i18n.t("ui.memory.panel.emptyHelp")}</div>
                </div>
              </li>
            }
          >
            <For each={filtered()}>
              {(item) => (
                <li data-slot="memory-panel-row" data-selected={selected()?.id === item.id ? "true" : undefined}>
                  <button
                    type="button"
                    onClick={() => setState("selected", item.id)}
                    aria-current={selected()?.id === item.id ? "true" : undefined}
                  >
                    <div data-slot="memory-panel-row-head">
                      <div data-slot="memory-panel-row-top">
                        <div data-slot="memory-panel-row-icons">
                          <Tooltip value={memoryAreaText(i18n, item.area)}>
                            <span
                              data-slot="memory-panel-row-icon-chip"
                              data-tone={item.area}
                              role="img"
                              aria-label={memoryAreaText(i18n, item.area)}
                            >
                              <Icon name={icon(item.area)} size="small" />
                            </span>
                          </Tooltip>
                          <Tooltip value={memoryDomainText(i18n, item.domain)}>
                            <span
                              data-slot="memory-panel-row-icon-chip"
                              data-tone="weak"
                              role="img"
                              aria-label={memoryDomainText(i18n, item.domain)}
                            >
                              <Icon name={domainIcon(item.domain)} size="small" />
                            </span>
                          </Tooltip>
                          <Show when={translationStatus(item)}>
                            <Tooltip
                              value={[
                                translationText(i18n, item),
                                translationProgress(item) !== undefined ? `${translationProgress(item)}%` : undefined,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            >
                              <span
                                data-slot="memory-panel-row-icon-chip"
                                data-tone={translationStatus(item) === "finished" ? "success" : "brand"}
                                role="img"
                                aria-label={translationText(i18n, item)}
                              >
                                <Show
                                  when={translationStatus(item) === "finished"}
                                  fallback={<Spinner class="size-3" />}
                                >
                                  <Icon name="check-small" size="small" />
                                </Show>
                              </span>
                            </Tooltip>
                          </Show>
                        </div>
                      </div>
                      <span data-slot="memory-panel-row-time">{since(i18n.locale(), item.time.updated)}</span>
                    </div>
                    <div data-slot="memory-panel-row-title">{memoryCopy(item, i18n.locale()).title}</div>
                    <div data-slot="memory-panel-row-body">{clip(memoryCopy(item, i18n.locale()).content)}</div>
                  </button>
                  <Show when={props.onRemove}>
                    <Tooltip value={i18n.t("ui.tool.memory.remove")}>
                      <IconButton
                        icon="close"
                        size="small"
                        variant="ghost"
                        data-slot="memory-panel-row-delete"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          props.onRemove?.(item.id)
                        }}
                        aria-label={i18n.t("ui.tool.memory.remove")}
                      />
                    </Tooltip>
                  </Show>
                </li>
              )}
            </For>
          </Show>
        </ul>

        <section data-slot="memory-panel-detail" aria-label="Entry detail">
          <Show
            when={selected()}
            fallback={
              <div data-slot="memory-panel-empty-card">
                <span data-slot="memory-panel-empty-icon">
                  <Icon name="chevron-right" size="small" />
                </span>
                <div data-slot="memory-panel-empty-copy">
                  <div data-slot="memory-panel-empty-title">{i18n.t("ui.memory.panel.noSelection")}</div>
                  <div data-slot="memory-panel-empty-body">{i18n.t("ui.memory.panel.noSelectionHelp")}</div>
                </div>
              </div>
            }
          >
            {(item) => (
              <>
                <div data-slot="memory-panel-detail-head">
                  <div>
                    <div data-slot="memory-panel-detail-title">{memoryCopy(item(), i18n.locale()).title}</div>
                    <div data-slot="memory-panel-detail-subtitle">{memoryCopy(item(), i18n.locale()).content}</div>
                  </div>
                  <div data-slot="memory-panel-detail-side">
                    <div data-slot="memory-panel-detail-meta">
                      <div data-slot="memory-panel-detail-time-row">
                        <Tooltip
                          value={
                            translationStatus(item())
                              ? [
                                  translationText(i18n, item()),
                                  translationProgress(item()) !== undefined
                                    ? `${translationProgress(item())}%`
                                    : undefined,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : i18n.t("ui.memory.panel.translate")
                          }
                        >
                          <span
                            data-slot="memory-panel-detail-translate-chip"
                            data-done={translationStatus(item()) === "finished" ? "true" : undefined}
                            data-active={
                              translationStatus(item()) && translationStatus(item()) !== "finished" ? "true" : undefined
                            }
                            role="img"
                            aria-label={
                              translationStatus(item())
                                ? translationText(i18n, item())
                                : i18n.t("ui.memory.panel.translate")
                            }
                          >
                            <Show
                              when={translationStatus(item()) === "finished"}
                              fallback={<Icon name="edit-small-2" size="small" />}
                            >
                              <Icon name="check-small" size="small" />
                            </Show>
                          </span>
                        </Tooltip>
                        <span data-slot="memory-panel-detail-time">{since(i18n.locale(), item().time.updated)}</span>
                      </div>
                      <Show when={item().created_by}>
                        <span data-slot="memory-panel-detail-creator">{item().created_by}</span>
                      </Show>
                      <Show when={item().updated_by && item().updated_by !== item().created_by}>
                        <span data-slot="memory-panel-detail-updater">@{item().updated_by}</span>
                      </Show>
                    </div>

                    <div data-slot="memory-panel-detail-icons">
                      <Tooltip value={`${i18n.t("ui.memory.area")}: ${memoryAreaText(i18n, item().area)}`}>
                        <span
                          data-slot="memory-panel-detail-icon-chip"
                          data-tone={
                            item().area === "project_rules"
                              ? "success"
                              : item().area === "atlas_private"
                                ? "weak"
                                : item().area === "feature_memory"
                                  ? "brand"
                                  : "base"
                          }
                          role="img"
                          aria-label={memoryAreaText(i18n, item().area)}
                        >
                          <Icon name={icon(item().area)} size="small" />
                        </span>
                      </Tooltip>
                      <Tooltip value={`${i18n.t("ui.memory.class")}: ${memoryClassText(i18n, item().class)}`}>
                        <span
                          data-slot="memory-panel-detail-icon-chip"
                          data-tone="weak"
                          role="img"
                          aria-label={memoryClassText(i18n, item().class)}
                        >
                          <Icon name={classIcon(item().class)} size="small" />
                        </span>
                      </Tooltip>
                      <Tooltip value={`${i18n.t("ui.common.status")}: ${memoryStatusText(i18n, item().status)}`}>
                        <span
                          data-slot="memory-panel-detail-icon-chip"
                          data-tone={item().status === "active" ? "success" : "weak"}
                          role="img"
                          aria-label={memoryStatusText(i18n, item().status)}
                        >
                          <Icon name={statusIcon(item().status)} size="small" />
                        </span>
                      </Tooltip>
                      <Tooltip value={`${i18n.t("ui.memory.domain")}: ${memoryDomainText(i18n, item().domain)}`}>
                        <span
                          data-slot="memory-panel-detail-icon-chip"
                          data-tone="weak"
                          role="img"
                          aria-label={memoryDomainText(i18n, item().domain)}
                        >
                          <Icon name={domainIcon(item().domain)} size="small" />
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                <Section title={i18n.t("ui.memory.panel.summary")} value={memoryCopy(item(), i18n.locale()).content} />
                <Section title={i18n.t("ui.memory.panel.scope")} value={item().scope} />
                <Section title={i18n.t("ui.memory.payload")} value={pretty(item().payload)} mono />
                <Section title={i18n.t("ui.memory.meta")} value={pretty(item().meta)} mono />

                <div data-slot="memory-panel-detail-footer">
                  <div data-slot="memory-panel-field-grid">
                    <Field label={i18n.t("ui.memory.kind")} value={memoryKindText(i18n, item().kind)} />
                    <Field label={i18n.t("ui.memory.source")} value={item().source_id} />
                    <Field
                      label={i18n.t("ui.memory.panel.updatedAt")}
                      value={since(i18n.locale(), item().time.updated)}
                    />
                  </div>

                  <Show when={item().tags.length > 0}>
                    <div data-slot="memory-panel-tags">
                      <For each={item().tags}>{(tag) => <Tag>#{tag}</Tag>}</For>
                    </div>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </section>
      </div>
    </div>
  )
}
