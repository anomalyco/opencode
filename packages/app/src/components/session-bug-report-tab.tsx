import { createMemo } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { BugReportPanel } from "@opencode-ai/ui-team/bug-report-panel"
import { useLanguage } from "@/context/language"
import { useBugReport } from "@/context/bug-report"
import { useSessionLayout } from "@/pages/session/session-layout"
import { formatServerError } from "@/utils/server-errors"

export function SessionBugReportTab(props: { class?: string } = {}) {
  const language = useLanguage()
  const bugReport = useBugReport()
  const { view } = useSessionLayout()

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let next: { x: number; y: number } | undefined

  const restore = () => {
    const el = scroll
    if (!el) return
    const pos = view().scroll("bug-report")
    if (!pos) return
    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const onScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    next = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const pos = next
      next = undefined
      if (!pos) return
      view().setScroll("bug-report", pos)
    })
  }

  const translate = async (force = false) => {
    await bugReport.translate(force).catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    })
  }

  const stop = async () => {
    await bugReport.stop().catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    })
  }

  const reports = createMemo(() =>
    bugReport.reports.map((r) => ({
      id: r.id,
      project_name: r.project_name,
      agent: r.agent,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      title_ui: r.title_ui,
      summary_ui: r.summary_ui,
      area: r.area,
      tool_name: r.tool_name,
      impact: r.impact,
      impact_ui: r.impact_ui,
      repro: r.repro,
      repro_ui: r.repro_ui,
      expected: r.expected,
      expected_ui: r.expected_ui,
      actual: r.actual,
      actual_ui: r.actual_ui,
      suggestion: r.suggestion,
      suggestion_ui: r.suggestion_ui,
      ui_locale: r.ui_locale,
      is_translate: r.is_translate,
      translate_status: r.translate_status,
      translate_done: r.translate_done,
      translate_total: r.translate_total,
      time: r.time,
      created_at: r.created_at,
    })),
  )

  return (
    <ScrollView
      class={`h-full ${props.class ?? ""}`.trim()}
      viewportRef={(el) => {
        scroll = el
        restore()
      }}
      onScroll={onScroll}
    >
      <div class="px-6 pt-4 pb-10">
        <BugReportPanel
          reports={reports()}
          count={bugReport.count}
          translating={bugReport.translating}
          onTranslate={() => void translate()}
          onForceTranslate={() => void translate(true)}
          onStopTranslate={() => void stop()}
          onRemove={(id: string) => void bugReport.remove(id)}
          translateError={bugReport.error}
          onClearTranslateError={() => bugReport.clearError()}
        />
      </div>
    </ScrollView>
  )
}
