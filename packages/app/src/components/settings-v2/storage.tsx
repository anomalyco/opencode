import type {
  StorageAnalyzeResponse,
  StorageBackupResponse,
  StorageCheckpointResponse,
  StorageCompactResponse,
  StorageProgressResponse,
  StorageStatusResponse,
  StorageVacuumResponse,
} from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Progress } from "@opencode-ai/ui/progress"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show, createEffect, createMemo, createResource, onCleanup, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { formatBytes, formatCount } from "./storage-format"
import "./settings-v2.css"

type Operation = "analyze" | "backup" | "compact" | "checkpoint" | "vacuum"

type StorageState = {
  operation?: Operation
  analysis?: StorageAnalyzeResponse
  result?: string
  backupPath?: string
  error?: string
}

type Response<T> = { data?: T }

const DialogStorageConfirm: Component<{
  title: string
  description: string
  estimate: string
  action: string
  danger?: boolean
  onConfirm: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog fit class="settings-v2-storage-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{props.title}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-storage-dialog-body">
        <p>{props.description}</p>
        <p class="settings-v2-storage-dialog-estimate">{props.estimate}</p>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant={props.danger ? "danger" : "contrast"}
          onClick={() => {
            dialog.close()
            props.onConfirm()
          }}
        >
          {props.action}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

export const SettingsStorageV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const dialog = useDialog()
  const locale = () => language.intl()
  const [state, setState] = createStore<StorageState>({})

  const unwrap = <T,>(response: Response<T>) => {
    if (response.data !== undefined) return response.data
    throw new Error(language.t("settings.storage.error.emptyResponse"))
  }

  const [status, { refetch }] = createResource(
    () => serverSdk().url,
    async () => unwrap<StorageStatusResponse>(await serverSdk().client.storage.status()),
  )
  const [progress, { refetch: refetchProgress }] = createResource(
    () => serverSdk().url,
    async () => unwrap<StorageProgressResponse>(await serverSdk().client.storage.progress()),
  )

  const activeOperation = () => state.operation ?? progress()?.operation ?? undefined
  const busy = () => activeOperation() !== undefined
  const operationVariant = (operation: Operation, fallback: "neutral" | "warning" | "danger" = "neutral") =>
    activeOperation() === operation ? "loading" : fallback
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

  createEffect(() => {
    if (!busy()) return
    void refetchProgress()
    const timer = window.setInterval(() => void refetchProgress(), 500)
    onCleanup(() => window.clearInterval(timer))
  })

  const execute = async <T,>(
    operation: Operation,
    request: () => Promise<Response<T>>,
    complete: (result: T) => { message: string; backupPath?: string },
    clearAnalysis = false,
  ) => {
    if (busy()) return
    setState({ operation, error: undefined, result: undefined, backupPath: undefined })
    let succeeded = false
    try {
      const result = unwrap(await request())
      const done = complete(result)
      setState({ result: done.message, backupPath: done.backupPath })
      if (clearAnalysis) setState("analysis", undefined)
      succeeded = true
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.storage.toast.completed"),
        description: done.message,
      })
    } catch (error) {
      const message = errorMessage(error)
      setState("error", message)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setState("operation", undefined)
      void refetchProgress()
      if (succeeded) void refetch()
    }
  }

  const analyze = () => {
    setState("analysis", undefined)
    return execute(
      "analyze",
      () => serverSdk().client.storage.analyze(),
      (result: StorageAnalyzeResponse) => {
        setState("analysis", result)
        return {
          message: language.t("settings.storage.result.analyze", {
            count: formatCount(result.candidates, locale()),
            size: formatBytes(result.payloadBytesReclaimable, locale()),
          }),
        }
      },
    )
  }

  const backup = () =>
    execute(
      "backup",
      () => serverSdk().client.storage.backup({ confirmed: true }),
      (result: StorageBackupResponse) => ({
        message: language.t("settings.storage.result.backup", { size: formatBytes(result.bytes, locale()) }),
        backupPath: result.path,
      }),
    )

  const compact = () =>
    execute(
      "compact",
      () => serverSdk().client.storage.compact({ confirmed: true }),
      (result: StorageCompactResponse) => ({
        message: language.t("settings.storage.result.compact", {
          count: formatCount(result.rewritten, locale()),
          size: formatBytes(result.payloadBytesReclaimable, locale()),
        }),
        backupPath: result.backup.path,
      }),
      true,
    )

  const checkpoint = () =>
    execute(
      "checkpoint",
      () => serverSdk().client.storage.checkpoint({ confirmed: true }),
      (result: StorageCheckpointResponse) => ({
        message: language.t(
          result.busy ? "settings.storage.result.checkpointBusy" : "settings.storage.result.checkpoint",
          {
            before: formatBytes(result.before.walBytes, locale()),
            after: formatBytes(result.after.walBytes, locale()),
          },
        ),
      }),
      true,
    )

  const vacuum = () =>
    execute(
      "vacuum",
      () => serverSdk().client.storage.vacuum({ confirmed: true }),
      (result: StorageVacuumResponse) => ({
        message: language.t(
          result.checkpointBusy ? "settings.storage.result.vacuumCheckpointBusy" : "settings.storage.result.vacuum",
          {
            size: formatBytes(result.bytesReclaimed, locale()),
          },
        ),
        backupPath: result.backup.path,
      }),
      true,
    )

  const openConfirm = (operation: Exclude<Operation, "analyze">) => {
    const current = status()
    if (!current || busy()) return
    const analysis = state.analysis
    const config = {
      backup: {
        title: language.t("settings.storage.confirm.backup.title"),
        description: language.t("settings.storage.confirm.backup.description"),
        estimate: language.t("settings.storage.confirm.backup.estimate", {
          size: formatBytes(current.totalBytes, locale()),
        }),
        action: language.t("settings.storage.action.backup"),
        run: backup,
      },
      compact: {
        title: language.t("settings.storage.confirm.compact.title"),
        description: language.t("settings.storage.confirm.compact.description"),
        estimate: language.t("settings.storage.confirm.compact.estimate", {
          count: formatCount(analysis?.candidates ?? 0, locale()),
          size: formatBytes(analysis?.payloadBytesReclaimable ?? 0, locale()),
          backup: formatBytes(current.totalBytes, locale()),
        }),
        action: language.t("settings.storage.action.compact"),
        run: compact,
      },
      checkpoint: {
        title: language.t("settings.storage.confirm.checkpoint.title"),
        description: language.t("settings.storage.confirm.checkpoint.description"),
        estimate: language.t("settings.storage.confirm.checkpoint.estimate", {
          size: formatBytes(current.walBytes, locale()),
        }),
        action: language.t("settings.storage.action.checkpoint"),
        run: checkpoint,
      },
      vacuum: {
        title: language.t("settings.storage.confirm.vacuum.title"),
        description: language.t("settings.storage.confirm.vacuum.description"),
        estimate: language.t("settings.storage.confirm.vacuum.estimate", {
          size: formatBytes(current.reusableBytes, locale()),
          backup: formatBytes(current.totalBytes, locale()),
        }),
        action: language.t("settings.storage.action.vacuum"),
        run: vacuum,
        danger: true,
      },
    }[operation]
    dialog.push(() => <DialogStorageConfirm {...config} onConfirm={() => void config.run()} />)
  }

  const metrics = createMemo(() => {
    const current = status()
    if (!current) return []
    return [
      { label: language.t("settings.storage.metric.total"), value: formatBytes(current.totalBytes, locale()) },
      { label: language.t("settings.storage.metric.database"), value: formatBytes(current.databaseBytes, locale()) },
      { label: language.t("settings.storage.metric.wal"), value: formatBytes(current.walBytes, locale()) },
      { label: language.t("settings.storage.metric.allocated"), value: formatBytes(current.allocatedBytes, locale()) },
      { label: language.t("settings.storage.metric.reusable"), value: formatBytes(current.reusableBytes, locale()) },
    ]
  })

  const excluded = () => {
    const analysis = state.analysis
    if (!analysis) return 0
    return analysis.projectionMismatches + analysis.compatibilityRejected + analysis.malformed
  }

  const progressLabel = () => {
    const phase = progress()?.phase
    const key = {
      idle: "settings.storage.progress.idle",
      snapshot: "settings.storage.progress.snapshot",
      verify: "settings.storage.progress.verify",
      index: "settings.storage.progress.index",
      analyze: "settings.storage.progress.analyze",
      backup: "settings.storage.progress.backup",
      drain: "settings.storage.progress.drain",
      compact: "settings.storage.progress.compact",
      checkpoint: "settings.storage.progress.checkpoint",
      vacuum: "settings.storage.progress.vacuum",
    }[phase ?? "idle"]
    return language.t(key)
  }

  const progressValue = () => {
    const current = progress()
    if (!current?.total) return 0
    return Math.min(100, (current.completed / current.total) * 100)
  }

  const progressDetail = () => {
    const current = progress()
    if (!current) return ""
    if (!current.total) {
      return language.t("settings.storage.progress.workers", { count: formatCount(current.workers, locale()) })
    }
    if (current.phase === "drain") {
      return language.t("settings.storage.progress.drainDetail", {
        completed: formatCount(current.completed, locale()),
        total: formatCount(current.total, locale()),
      })
    }
    return language.t("settings.storage.progress.detail", {
      completed: formatCount(current.completed, locale()),
      total: formatCount(current.total, locale()),
      count: formatCount(current.workers, locale()),
    })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.storage.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-storage">
        <p class="settings-v2-storage-intro">{language.t("settings.storage.description")}</p>

        <Show when={busy()}>
          <div class="settings-v2-storage-progress">
            <Progress
              value={progressValue()}
              minValue={0}
              maxValue={100}
              indeterminate={!progress()?.total}
              showValueLabel={Boolean(progress()?.total)}
            >
              {progressLabel()}
            </Progress>
            <span>{progressDetail()}</span>
          </div>
        </Show>

        <Show
          when={status()}
          fallback={
            <div class="settings-v2-storage-status">
              <span>
                {status.error
                  ? language.t("settings.storage.error.unavailable")
                  : language.t("settings.storage.status.loading")}
              </span>
              <Show when={status.error}>
                <span class="settings-v2-storage-error">{errorMessage(status.error)}</span>
                <ButtonV2 size="normal" variant="neutral" onClick={() => void refetch()}>
                  {language.t("common.retry")}
                </ButtonV2>
              </Show>
            </div>
          }
        >
          {(current) => (
            <>
              <div class="settings-v2-section">
                <div class="settings-v2-storage-section-heading">
                  <h3 class="settings-v2-section-title">{language.t("settings.storage.section.overview")}</h3>
                  <ButtonV2 size="small" variant="ghost-muted" disabled={busy()} onClick={() => void refetch()}>
                    {language.t("common.refresh")}
                  </ButtonV2>
                </div>
                <div class="settings-v2-storage-metrics">
                  <For each={metrics()}>
                    {(metric) => (
                      <div class="settings-v2-storage-metric">
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </div>
                    )}
                  </For>
                </div>
                <div class="settings-v2-storage-path">
                  <span>{language.t("settings.storage.metric.path")}</span>
                  <code>{current().path}</code>
                </div>
              </div>

              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">{language.t("settings.storage.section.history")}</h3>
                <SettingsListV2>
                  <SettingsRowV2
                    title={language.t("settings.storage.action.analyze")}
                    description={language.t("settings.storage.action.analyze.description")}
                  >
                    <ButtonV2 variant={operationVariant("analyze")} disabled={busy()} onClick={() => void analyze()}>
                      {language.t("settings.storage.action.analyze")}
                    </ButtonV2>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("settings.storage.action.compact")}
                    description={language.t("settings.storage.action.compact.description")}
                  >
                    <ButtonV2
                      variant={operationVariant("compact", "warning")}
                      disabled={busy() || !state.analysis || state.analysis.candidates === 0}
                      onClick={() => openConfirm("compact")}
                    >
                      {language.t("settings.storage.action.compact")}
                    </ButtonV2>
                  </SettingsRowV2>
                </SettingsListV2>

                <Show when={state.analysis}>
                  {(analysis) => (
                    <div class="settings-v2-storage-analysis">
                      <div class="settings-v2-storage-analysis-summary">
                        <div>
                          <span>{language.t("settings.storage.analysis.candidates")}</span>
                          <strong>{formatCount(analysis().candidates, locale())}</strong>
                        </div>
                        <div>
                          <span>{language.t("settings.storage.analysis.reclaimable")}</span>
                          <strong>{formatBytes(analysis().payloadBytesReclaimable, locale())}</strong>
                        </div>
                        <div>
                          <span>{language.t("settings.storage.analysis.excluded")}</span>
                          <strong>{formatCount(excluded(), locale())}</strong>
                        </div>
                      </div>
                      <Show when={Object.entries(analysis().byType).length > 0}>
                        <div class="settings-v2-storage-analysis-types">
                          <For
                            each={Object.entries(analysis().byType).sort(([left], [right]) =>
                              left.localeCompare(right),
                            )}
                          >
                            {([type, summary]) => (
                              <div>
                                <code>{type}</code>
                                <span>
                                  {language.t("settings.storage.analysis.type", {
                                    count: formatCount(summary.events, locale()),
                                    size: formatBytes(summary.payloadBytesReclaimable, locale()),
                                  })}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                      <p>{language.t("settings.storage.analysis.note")}</p>
                    </div>
                  )}
                </Show>
              </div>

              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">{language.t("settings.storage.section.database")}</h3>
                <SettingsListV2>
                  <SettingsRowV2
                    title={language.t("settings.storage.action.backup")}
                    description={language.t("settings.storage.action.backup.description")}
                  >
                    <ButtonV2
                      variant={operationVariant("backup")}
                      disabled={busy()}
                      onClick={() => openConfirm("backup")}
                    >
                      {language.t("settings.storage.action.backup")}
                    </ButtonV2>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("settings.storage.action.checkpoint")}
                    description={language.t("settings.storage.action.checkpoint.description")}
                  >
                    <ButtonV2
                      variant={operationVariant("checkpoint")}
                      disabled={busy() || current().walBytes === 0}
                      onClick={() => openConfirm("checkpoint")}
                    >
                      {language.t("settings.storage.action.checkpoint")}
                    </ButtonV2>
                  </SettingsRowV2>
                  <SettingsRowV2
                    title={language.t("settings.storage.action.vacuum")}
                    description={language.t("settings.storage.action.vacuum.description")}
                  >
                    <ButtonV2
                      variant={operationVariant("vacuum", "danger")}
                      disabled={busy()}
                      onClick={() => openConfirm("vacuum")}
                    >
                      {language.t("settings.storage.action.vacuum")}
                    </ButtonV2>
                  </SettingsRowV2>
                </SettingsListV2>
              </div>

              <Show when={state.result || state.error}>
                <div class="settings-v2-storage-result" data-error={state.error ? "true" : undefined}>
                  <strong>
                    {state.error
                      ? language.t("settings.storage.result.failed")
                      : language.t("settings.storage.result.completed")}
                  </strong>
                  <span>{state.error ?? state.result}</span>
                  <Show when={state.backupPath}>
                    {(path) => (
                      <span class="settings-v2-storage-result-path">
                        {language.t("settings.storage.result.backupPath")}
                        <code>{path()}</code>
                      </span>
                    )}
                  </Show>
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </>
  )
}
