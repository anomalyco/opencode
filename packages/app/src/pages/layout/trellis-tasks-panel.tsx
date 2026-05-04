import { createEffect, createResource, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { Icon, type IconName } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/util/path"
import { useLanguage } from "@/context/language"
import { usePlatform, type TrellisTask } from "@/context/platform"
import { errorMessage } from "./helpers"

const labelStatus = (status: string) =>
  status
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown"

const meta = (task: TrellisTask) =>
  [task.priority, task.assignee, task.package].filter((item): item is string => !!item)

const rank = (task: TrellisTask) => {
  if (task.current) return 0
  if (task.status === "in_progress" || task.status === "implementing") return 1
  if (task.status === "planning") return 2
  if (task.status === "review") return 3
  if (task.completedAt || task.status === "done" || task.status === "completed") return 5
  return 4
}

const progressIcon = (task: TrellisTask): IconName => {
  if (task.completedAt || task.status === "done" || task.status === "completed") return "progress-complete"
  if (task.status === "review") return "progress-three-quarter"
  if (task.status === "in_progress" || task.status === "implementing") return "progress-half"
  if (task.status === "planning") return "progress-quarter"
  return "progress-empty"
}

const progressColor = (task: TrellisTask): string => {
  if (task.completedAt || task.status === "done" || task.status === "completed") return "text-icon-success-base"
  if (task.status === "review") return "text-icon-warning-base"
  if (task.status === "in_progress" || task.status === "implementing") return "text-icon-brand-base"
  if (task.status === "planning") return "text-icon-info-base"
  return "text-icon-base"
}

function TaskCard(props: { task: TrellisTask; onOpen: (path: string) => void }): JSX.Element {
  const language = useLanguage()
  const done = createMemo(
    () => props.task.completedAt || props.task.status === "done" || props.task.status === "completed",
  )
  const items = createMemo(() => meta(props.task))
  const folderName = createMemo(() => getFilename(props.task.path))
  const icon = createMemo(() => progressIcon(props.task))
  const iconColor = createMemo(() => progressColor(props.task))

  return (
    <button
      type="button"
      class="group/task w-full rounded-xl border border-border-weak-base bg-background-stronger px-3 py-3 text-left transition-colors hover:bg-surface-base-hover"
      classList={{ "border-border-brand-base bg-surface-interactive-selected/40": props.task.current }}
      onClick={() => props.onOpen(props.task.path)}
    >
      <div class="flex items-start gap-3">
        <div
          class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border-weak-base bg-background-base"
          classList={{ [iconColor()]: true, "text-icon-brand-base": props.task.current }}
        >
          <Icon name={icon()} size="small" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <div class="min-w-0 truncate text-14-medium text-text-strong">{folderName()}</div>
            <Show when={props.task.current}>
              <span class="shrink-0 rounded-full bg-surface-info-base px-2 py-0.5 text-11-medium text-text-strong">
                {language.t("trellis.tasks.current")}
              </span>
            </Show>
          </div>
          <div class="mt-1 truncate text-12-regular text-text-base">{props.task.title}</div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-12-regular">
            <span class="rounded-md bg-surface-base/40 px-1.5 py-0.5 text-text-strong">
              {labelStatus(props.task.status)}
            </span>
            <For each={items()}>
              {(item) => <span class="rounded-md bg-surface-base/40 px-1.5 py-0.5 text-text-base">{item}</span>}
            </For>
          </div>
        </div>
      </div>
    </button>
  )
}

export function TrellisTasksPanel(props: {
  directory: Accessor<string>
  width: Accessor<number>
  mobile?: boolean
  onBack: () => void
}): JSX.Element {
  const platform = usePlatform()
  const language = useLanguage()
  const dir = createMemo(() => props.directory())
  const [data, { refetch }] = createResource(dir, async (root) => {
    if (!root) return undefined
    if (!platform.listTrellisTasks) return undefined
    console.debug(`[trellis] loading tasks for ${root}`)
    return platform.listTrellisTasks(root)
  })

  createEffect(() => {
    const err = data.error
    if (!err) return
    console.debug(`[trellis] failed to load tasks: ${errorMessage(err, "unknown")}`)
  })

  const tasks = createMemo(() =>
    (data()?.tasks ?? []).slice().sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)),
  )
  const skipped = createMemo(() => data()?.skipped ?? 0)
  const open = (path: string) => {
    if (platform.openPath) {
      void platform.openPath(path)
      return
    }
    if (platform.openInFinder) void platform.openInFinder(path)
  }

  return (
    <div
      data-component="sidebar-panel"
      class="flex h-full min-h-0 min-w-0 flex-col rounded-tl-[12px] border-l border-t border-border-weaker-base bg-background-base px-3"
      style={{ width: props.mobile ? undefined : `${props.width()}px` }}
    >
      <div class="shrink-0 px-1 py-3">
        <div class="flex items-start justify-between gap-2 py-1 pl-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <Tooltip placement="bottom" value={language.t("trellis.tasks.back")}>
                <IconButton
                  icon="arrow-left"
                  variant="ghost"
                  size="small"
                  class="-ml-1 rounded-md"
                  aria-label={language.t("trellis.tasks.back")}
                  onClick={props.onBack}
                />
              </Tooltip>
              <div class="text-14-medium text-text-strong">{language.t("trellis.tasks.title")}</div>
            </div>
            <div class="mt-1 truncate text-12-regular text-text-base">
              {dir() || language.t("trellis.tasks.noProject")}
            </div>
          </div>
          <Tooltip placement="bottom" value={language.t("trellis.tasks.refresh")}>
            <IconButton
              icon="refresh"
              variant="ghost"
              size="large"
              class="shrink-0 rounded-lg"
              disabled={!dir() || !platform.listTrellisTasks || data.loading}
              aria-label={language.t("trellis.tasks.refresh")}
              onClick={() => void refetch()}
            />
          </Tooltip>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-1 pb-4">
        <Show when={platform.listTrellisTasks} fallback={<Empty text={language.t("trellis.tasks.desktopOnly")} />}>
          <Show when={dir()} fallback={<Empty text={language.t("trellis.tasks.noProject")} />}>
            <Show when={!data.loading} fallback={<Empty text={language.t("trellis.tasks.loading")} />}>
              <Show
                when={!data.error}
                fallback={<ErrorCard err={errorMessage(data.error, language.t("common.requestFailed"))} />}
              >
                <Show when={tasks().length > 0} fallback={<Empty text={language.t("trellis.tasks.empty")} />}>
                  <div class="flex flex-col gap-2">
                    <For each={tasks()}>{(task) => <TaskCard task={task} onOpen={open} />}</For>
                  </div>
                </Show>
                <Show when={skipped() > 0}>
                  <div class="mt-2 rounded-lg border border-border-warning-base bg-surface-warning-base px-3 py-2 text-12-regular text-text-strong">
                    {language.t("trellis.tasks.skipped", { count: skipped() })}
                  </div>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}

function Empty(props: { text: string }): JSX.Element {
  return <div class="px-4 py-10 text-center text-14-regular text-text-base">{props.text}</div>
}

function ErrorCard(props: { err: string }): JSX.Element {
  return (
    <div class="rounded-xl border border-border-critical-base bg-surface-critical-base px-3 py-3 text-13-regular text-text-strong">
      {props.err}
    </div>
  )
}
