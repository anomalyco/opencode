import "./bug-report-panel.css"

import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "../../../ui/src/components/button"
import { Card, CardTitle, CardDescription } from "../../../ui/src/components/card"
import { Collapsible } from "../../../ui/src/components/collapsible"
import { Icon, type IconProps } from "../../../ui/src/components/icon"
import { IconButton } from "../../../ui/src/components/icon-button"
import { Tag } from "../../../ui/src/components/tag"
import { Tooltip } from "../../../ui/src/components/tooltip"
import { AnimatedNumber } from "../../../ui/src/components/animated-number"
import { useI18n, type UiI18n } from "../../../ui/src/context/i18n"
import { TranslationBanner } from "./translation-state"
import { Spinner } from "../../../ui/src/components/spinner"

export type BugReportEntry = {
  id: string
  project_name: string
  agent: string
  kind: "bug" | "suggestion" | "feature"
  title: string
  summary: string
  title_ui?: string
  summary_ui?: string
  area?: string
  tool_name?: string
  impact?: string
  impact_ui?: string
  repro?: string
  repro_ui?: string
  expected?: string
  expected_ui?: string
  actual?: string
  actual_ui?: string
  suggestion?: string
  suggestion_ui?: string
  ui_locale?: string
  is_translate?: boolean
  translate_status?: "idle" | "waiting" | "started" | "finished"
  translate_done?: number
  translate_total?: number
  time: number
  created_at: string
}

export interface BugReportPanelProps {
  reports: BugReportEntry[]
  count: number
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

function kindIcon(kind: BugReportEntry["kind"]): IconProps["name"] {
  if (kind === "bug") return "warning"
  if (kind === "suggestion") return "help"
  if (kind === "feature") return "plus-small"
  return "help"
}

function kindTone(kind: BugReportEntry["kind"]) {
  if (kind === "bug") return "critical"
  if (kind === "suggestion") return "brand"
  if (kind === "feature") return "success"
  return "base"
}

function kindText(i18n: UiI18n, kind: BugReportEntry["kind"]) {
  return i18n.t(`ui.bugReport.kind.${kind}`)
}

function areaIcon(area: string): IconProps["name"] {
  const a = area.toLowerCase()
  if (a.includes("security")) return "shield"
  if (a.includes("performance")) return "console"
  if (a.includes("frontend")) return "code"
  if (a.includes("memory")) return "brain"
  if (a.includes("config")) return "settings-gear"
  return "help"
}

function note(kind: BugReportEntry["kind"]) {
  if (kind === "feature") return "ui.bugReport.featureRequest"
  return "ui.bugReport.suggestion"
}

function copy(item: BugReportEntry, locale: string) {
  if (item.ui_locale !== locale) {
    return {
      title: item.title,
      summary: item.summary,
      impact: item.impact,
      repro: item.repro,
      expected: item.expected,
      actual: item.actual,
      suggestion: item.suggestion,
    }
  }
  return {
    title: item.title_ui ?? item.title,
    summary: item.summary_ui ?? item.summary,
    impact: item.impact_ui ?? item.impact,
    repro: item.repro_ui ?? item.repro,
    expected: item.expected_ui ?? item.expected,
    actual: item.actual_ui ?? item.actual,
    suggestion: item.suggestion_ui ?? item.suggestion,
  }
}

function translationStatus(item: Pick<BugReportEntry, "is_translate" | "translate_status">) {
  if (item.translate_status && item.translate_status !== "idle") return item.translate_status
  if (item.is_translate) return "finished" as const
}

function translationProgress(item: Pick<BugReportEntry, "translate_done" | "translate_total">) {
  const total = item.translate_total
  const done = item.translate_done
  if (!total || total <= 0 || done === undefined) return
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

function translationText(i18n: UiI18n, item: BugReportEntry) {
  const status = translationStatus(item)
  if (status === "finished") return i18n.t("ui.translation.completed")
  if (status === "started") return i18n.t("ui.translation.started")
  if (status === "waiting") return i18n.t("ui.translation.waiting")
  return i18n.t("ui.bugReport.translate")
}

function BugReportCard(props: { entry: BugReportEntry; onRemove?: (id: string) => void }) {
  const i18n = useI18n()
  const ui = () => copy(props.entry, i18n.locale())
  return (
    <li data-slot="bug-report-card">
      <div data-slot="bug-report-card-header">
        <div data-slot="bug-report-card-title-wrap">
          <Tooltip value={kindText(i18n, props.entry.kind)}>
            <span
              data-slot="bug-report-card-icon"
              data-tone={kindTone(props.entry.kind)}
              role="img"
              aria-label={kindText(i18n, props.entry.kind)}
            >
              <Icon name={kindIcon(props.entry.kind)} size="small" />
            </span>
          </Tooltip>
          <Show when={props.entry.area}>
            <Tooltip value={props.entry.area!}>
              <span data-slot="bug-report-card-tag-icon" role="img" aria-label={props.entry.area!}>
                <Icon name={areaIcon(props.entry.area!)} size="small" />
              </span>
            </Tooltip>
          </Show>
          <Show when={props.entry.tool_name}>
            <Tooltip value={props.entry.tool_name!}>
              <span data-slot="bug-report-card-tag-icon" role="img" aria-label={props.entry.tool_name!}>
                <Icon name="terminal" size="small" />
              </span>
            </Tooltip>
          </Show>
          <span data-slot="bug-report-card-title">{ui().title}</span>
        </div>
        <Show when={props.onRemove}>
          <Tooltip value={i18n.t("ui.bugReport.action.delete")}>
            <IconButton
              icon="close"
              size="small"
              variant="ghost"
              data-slot="bug-report-card-delete"
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                props.onRemove?.(props.entry.id)
              }}
              aria-label={i18n.t("ui.bugReport.action.delete")}
            />
          </Tooltip>
        </Show>
      </div>
      <p data-slot="bug-report-card-summary">{ui().summary}</p>
      <Show when={ui().suggestion}>
        <div data-slot="bug-report-card-suggestion">
          <Tag data-kind={props.entry.kind}>{i18n.t(note(props.entry.kind))}</Tag>
          <p data-slot="bug-report-card-suggestion-text">{ui().suggestion}</p>
        </div>
      </Show>
      <div data-slot="bug-report-card-footer">
        <span data-slot="bug-report-card-agent">@{props.entry.agent}</span>
        <div data-slot="bug-report-card-footer-meta">
          <Tooltip
            value={[
              translationText(i18n, props.entry),
              translationProgress(props.entry) !== undefined ? `${translationProgress(props.entry)}%` : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <span
              data-slot="bug-report-card-translate-chip"
              data-done={translationStatus(props.entry) === "finished" ? "true" : undefined}
              data-active={
                translationStatus(props.entry) && translationStatus(props.entry) !== "finished" ? "true" : undefined
              }
              role="img"
              aria-label={translationText(i18n, props.entry)}
            >
              <Icon name={translationStatus(props.entry) === "finished" ? "check-small" : "circle-x"} size="small" />
            </span>
          </Tooltip>
          <span data-slot="bug-report-card-time">{since(i18n.locale(), props.entry.time)}</span>
        </div>
      </div>
    </li>
  )
}

export function BugReportPanel(props: BugReportPanelProps) {
  const i18n = useI18n()
  const reports = createMemo(() => props.reports ?? [])
  const count = createMemo(() => props.count ?? 0)
  const [kindFilter, setKindFilter] = createSignal<BugReportEntry["kind"] | "all">("all")

  const counts = createMemo(() => ({
    bug: reports().filter((r) => r.kind === "bug").length,
    suggestion: reports().filter((r) => r.kind === "suggestion").length,
    feature: reports().filter((r) => r.kind === "feature").length,
  }))

  const filtered = createMemo(() => {
    const kind = kindFilter()
    if (kind === "all") return reports()
    return reports().filter((r) => r.kind === kind)
  })

  return (
    <div data-component="bug-report-panel">
      <div data-slot="bug-report-panel-header">
        <div data-slot="bug-report-panel-copy">
          <span data-slot="bug-report-panel-title">{i18n.t("ui.bugReport.title")}</span>
          <span data-slot="bug-report-panel-desc">{i18n.t("ui.bugReport.description")}</span>
        </div>
        <div data-slot="bug-report-panel-actions">
          <Show when={props.onTranslate}>
            <Button
              size="small"
              variant="secondary"
              disabled={props.translating || reports().length === 0}
              onClick={() => props.onTranslate?.()}
            >
              <Show when={props.translating}>
                <Spinner class="size-3" />
              </Show>
              {props.translating ? i18n.t("ui.bugReport.translating") : i18n.t("ui.bugReport.translate")}
            </Button>
          </Show>
          <Show when={props.onForceTranslate}>
            <Button
              size="small"
              variant="secondary"
              disabled={props.translating || reports().length === 0}
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
          <Show when={count() > 0}>
            <span data-slot="bug-report-panel-count">
              <AnimatedNumber value={count()} />
            </span>
          </Show>
        </div>
      </div>
      <TranslationBanner
        translating={!!props.translating}
        items={reports()}
        label={i18n.t("ui.bugReport.translating")}
      />
      <Show when={props.translateError}>
        {(err) => (
          <Card variant="error">
            <CardTitle variant="error">{err().message}</CardTitle>
            <Collapsible>
              <Collapsible.Trigger>
                <span data-slot="bug-report-error-detail-toggle">{i18n.t("ui.toolErrorCard.failed")}</span>
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

      {/* Summary Cards — kind quick-filter */}
      <Show when={reports().length > 0}>
        <div data-slot="bug-report-panel-summary">
          <For
            each={
              [
                ["all", reports().length],
                ["bug", counts().bug],
                ["suggestion", counts().suggestion],
                ["feature", counts().feature],
              ] as const
            }
          >
            {([kind, kindCount]) => (
              <button
                type="button"
                data-slot="bug-report-panel-summary-card"
                data-active={kindFilter() === kind ? "true" : undefined}
                onClick={() =>
                  setKindFilter(kindFilter() === kind ? "all" : (kind as "bug" | "suggestion" | "feature" | "all"))
                }
                aria-pressed={kindFilter() === kind}
                aria-label={`${kind === "all" ? i18n.t("ui.bugReport.filters.allKinds") : kindText(i18n, kind as BugReportEntry["kind"])}: ${kindCount}`}
              >
                <span data-slot="bug-report-panel-summary-icon">
                  <Icon name={kind === "all" ? "bullet-list" : kindIcon(kind as BugReportEntry["kind"])} size="small" />
                </span>
                <span data-slot="bug-report-panel-summary-copy">
                  <span data-slot="bug-report-panel-summary-name">
                    {kind === "all"
                      ? i18n.t("ui.bugReport.filters.allKinds")
                      : kindText(i18n, kind as BugReportEntry["kind"])}
                  </span>
                  <span data-slot="bug-report-panel-summary-value">
                    <AnimatedNumber value={kindCount} />
                  </span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show
        when={filtered().length > 0}
        fallback={
          <div data-slot="bug-report-panel-empty">
            <span>{i18n.t("ui.bugReport.empty")}</span>
            <span data-slot="bug-report-panel-empty-desc">{i18n.t("ui.bugReport.emptyDescription")}</span>
          </div>
        }
      >
        <ul data-slot="bug-report-panel-list" aria-label={i18n.t("ui.bugReport.title")}>
          <For each={filtered()}>{(entry) => <BugReportCard entry={entry} onRemove={props.onRemove} />}</For>
        </ul>
      </Show>
    </div>
  )
}
