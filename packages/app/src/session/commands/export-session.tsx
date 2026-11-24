import { createSimpleContext } from "@opencode/ui/context"
import { createSignal, onCleanup, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { showToast } from "@/shell/notifications/toast"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "./export"
import {
  createSessionExportState,
  selectSessionExporting,
  transitionSessionExport,
  type SessionExportEffect,
  type SessionExportEvent,
  type SessionExportTarget,
} from "./export-machine"

/** Runs session exports for its owner's lifetime; leaving the owner aborts the fetches still paging. */
export function createSessionExporter() {
  const global = useGlobal()
  const language = useLanguage()
  const platform = usePlatform()
  const [exportState, setExportState] = createSignal(createSessionExportState())
  const fetches = new Map<number, AbortController>()

  const dispatch = (event: SessionExportEvent) => {
    const previous = untrack(exportState)
    const next = transitionSessionExport(previous, event)

    if (next.state !== previous) setExportState(next.state)
    next.effects.forEach((effect) =>
      Promise.try(() => run(effect)).catch((cause: unknown) => console.error("[session.export]", cause)),
    )
  }

  const failed = (attempt: number, target: SessionExportTarget) => (cause: unknown) =>
    dispatch({
      type: "export.failed",
      attempt,
      target,
      message: cause instanceof Error ? cause.message : undefined,
    })

  function run(effect: SessionExportEffect) {
    if (effect.type === "export.fetch") {
      const api = untrack(() => global.serverCtx(effect.target.server))?.sdk.api

      if (!api) return dispatch({ type: "export.failed", attempt: effect.attempt, target: effect.target })
      const controller = new AbortController()
      fetches.set(effect.attempt, controller)
      void fetchSessionExport({ sessionID: effect.target.sessionID, api, signal: controller.signal })
        .finally(() => fetches.delete(effect.attempt))
        .then(
          (data) => dispatch({ type: "export.fetched", attempt: effect.attempt, target: effect.target, data }),
          failed(effect.attempt, effect.target),
        )

      return
    }

    if (effect.type === "export.abort") {
      fetches.get(effect.attempt)?.abort()
      fetches.delete(effect.attempt)

      return
    }

    if (effect.type === "export.save") {
      const filename = sessionExportFilename(effect.data.info)
      void Promise.try(() => saveSessionExport(filename, effect.data, platform)).then(
        (saved) => dispatch({ type: "export.saved", attempt: effect.attempt, target: effect.target, filename, saved }),
        failed(effect.attempt, effect.target),
      )

      return
    }

    if (effect.type === "toast.exported") {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename: effect.filename }),
      })

      return
    }

    showToast({
      variant: "error",
      title: language.t("toast.session.export.failed.title"),
      description: effect.message ?? language.t("toast.session.export.failed.description"),
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    export: (target: SessionExportTarget) => dispatch({ type: "export.requested", target }),
    exporting: (target: SessionExportTarget) => selectSessionExporting(exportState(), target),
  }
}

/** One exporter for the session screen, so /export and the header menu share each session's export. */
export const { use: useSessionExporter, provider: SessionExportProvider } = createSimpleContext({
  name: "SessionExport",
  gate: false,
  init: createSessionExporter,
})
