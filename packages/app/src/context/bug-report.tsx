import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { onCleanup } from "solid-js"
import { useLanguage } from "./language"
import { useGlobalSDK } from "./global-sdk"
import { useSDK } from "./sdk"
import { align, hasActiveTranslations, issue, type TranslateError } from "@/utils/translation"
import { sdkJson } from "@/utils/sdk-team"

type BugReportEntry = {
  id: string
  project_id: string
  project_name: string
  session_id: string
  message_id: string
  call_id?: string
  agent: string
  worktree: string
  cwd: string
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

export const { use: useBugReport, provider: BugReportProvider } = createSimpleContext({
  name: "BugReport",
  init: () => {
    const globalSDK = useGlobalSDK()
    const language = useLanguage()
    const sdk = useSDK()

    const [store, setStore] = createStore({
      reports: [] as BugReportEntry[],
      loaded: false,
      translating: false,
      error: undefined as TranslateError | undefined,
    })

    const upsert = (entry: BugReportEntry) => {
      setStore("reports", (prev) => {
        const at = prev.findIndex((item) => item.id === entry.id)
        if (at === -1) return [...prev, entry]
        return prev.map((item, i) => (i === at ? entry : item))
      })
    }

    const removeByIds = (reportIDs: string[]) => {
      const idSet = new Set(reportIDs)
      setStore("reports", (prev) => prev.filter((item) => !idSet.has(item.id)))
    }

    const load = async () => {
      await sdkJson<BugReportEntry[]>(sdk.client, {
        path: "/bug-report",
        directory: sdk.directory,
      })
        .then((reports) => {
          setStore("reports", reports)
        })
        .catch(() => {})
      setStore("loaded", true)
    }

    const remove = async (id: string) => {
      const prev = store.reports
      setStore("reports", (r) => r.filter((item) => item.id !== id))
      await sdkJson(sdk.client, {
        path: `/bug-report/${encodeURIComponent(id)}`,
        directory: sdk.directory,
        method: "DELETE",
      }).catch(() => {
        setStore("reports", prev)
      })
    }

    const unsub = globalSDK.event.listen((e) => {
      const details = (e as any).details ?? (e as any).payload
      if (details?.type === "bug_report.removed") {
        const reportIDs = details.properties?.report_ids as string[] | undefined
        if (!reportIDs || reportIDs.length === 0) return
        removeByIds(reportIDs)
        return
      }
      if (details?.type !== "bug_report.created" && details?.type !== "bug_report.updated") return
      const entry = details.properties?.entry as BugReportEntry | undefined
      if (!entry) return
      upsert(entry)
    })

    const translate = async (force = false) => {
      if (store.translating || hasActiveTranslations(store.reports)) return 0
      setStore("translating", true)
      setStore("error", undefined)
      try {
        await align({
          sdk: sdk.client,
          directory: sdk.directory,
          locale: language.locale(),
        })
        const res = await sdkJson<{ count: number }>(sdk.client, {
          path: "/bug-report/translate",
          directory: sdk.directory,
          method: "POST",
          body: force ? { force: true } : undefined,
        })
        await load()
        return res.count ?? 0
      } catch (err) {
        setStore("error", issue({ err, t: language.t, tag: "bug-report", locale: language.locale() }))
        throw err
      } finally {
        setStore("translating", false)
      }
    }

    const stop = async () => {
      if (!store.translating && !hasActiveTranslations(store.reports)) return 0
      setStore("translating", true)
      setStore("error", undefined)
      try {
        const res = await sdkJson<{ count: number }>(sdk.client, {
          path: "/bug-report/translate/stop",
          directory: sdk.directory,
          method: "POST",
        })
        await load()
        return res.count ?? 0
      } catch (err) {
        setStore("error", issue({ err, t: language.t, tag: "bug-report", locale: language.locale() }))
        throw err
      } finally {
        setStore("translating", false)
      }
    }

    void load()

    onCleanup(() => {
      unsub()
    })

    return {
      get count() {
        return store.reports.length
      },
      get reports() {
        return store.reports
      },
      get loaded() {
        return store.loaded
      },
      get translating() {
        return store.translating || hasActiveTranslations(store.reports)
      },
      get error() {
        return store.error
      },
      refresh: load,
      translate,
      stop,
      remove,
      clearError() {
        setStore("error", undefined)
      },
    }
  },
})
