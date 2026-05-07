import { For, Show, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"

type PendingRow = {
  id: string
  text: string
  editing?: boolean
  disableUp: boolean
  disableDown: boolean
  disableMoveLane: boolean
  disableEdit: boolean
  editHint?: string
  disableDelete: boolean
}

export function SessionFollowupDock(props: {
  ready: boolean
  paused: boolean
  stopProjected?: boolean
  editing: boolean
  canResume: boolean
  loading: boolean
  steer: PendingRow[]
  queue: PendingRow[]
  onResume: () => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  onMoveLane: (id: string, lane: "steer" | "queue") => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const language = useLanguage()
  const status = createMemo(() => {
    if (props.loading && !props.ready) return language.t("common.loading")
    if (props.editing) return language.t("session.followupDock.editingBlocked")
    if (props.stopProjected || props.paused) return language.t("session.followupDock.paused")
    return undefined
  })
  const showHeader = createMemo(() => !!status() || (props.canResume && !props.stopProjected))

  return (
    <DockTray
      data-component="session-followup-dock"
      style={{
        "margin-bottom": "-1px",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <Show when={showHeader()}>
        <div class="px-3 pt-3 pb-2 flex items-center gap-2 border-b border-border-weak-base/70">
          <div class="min-w-0 flex-1">
            <Show when={status()}>
              {(label) => <div class="text-12-regular text-text-weak">{label()}</div>}
            </Show>
          </div>
          <Show when={props.canResume && !props.stopProjected}>
            <Button size="small" variant="secondary" disabled={props.loading} onClick={props.onResume}>
              {language.t("session.followupDock.resume")}
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={props.ready}>
        <div
          classList={{
            "px-3 pb-7 flex flex-col gap-3 max-h-52 overflow-y-auto [scrollbar-gutter:stable]": true,
            "pt-3": showHeader(),
            "pt-4": !showHeader(),
          }}
        >
          <Show when={props.steer.length > 0}>
            <Lane
              title={language.t("settings.general.row.followup.option.steer")}
              icon="arrow-right"
              items={props.steer}
              moveLabel={language.t("settings.general.row.followup.option.queue")}
              onMoveUp={props.onMoveUp}
              onMoveDown={props.onMoveDown}
              onMoveLane={(id) => props.onMoveLane(id, "queue")}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
            />
          </Show>
          <Show when={props.queue.length > 0}>
            <Lane
              title={language.t("settings.general.row.followup.option.queue")}
              icon="arrow-down-to-line"
              items={props.queue}
              moveLabel={language.t("settings.general.row.followup.option.steer")}
              onMoveUp={props.onMoveUp}
              onMoveDown={props.onMoveDown}
              onMoveLane={(id) => props.onMoveLane(id, "steer")}
              onEdit={props.onEdit}
              onDelete={props.onDelete}
            />
          </Show>
        </div>
      </Show>
    </DockTray>
  )
}

function Lane(props: {
  title: string
  icon: string
  items: PendingRow[]
  moveLabel: string
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  onMoveLane: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const language = useLanguage()

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2 px-1">
        <Icon name={props.icon as any} size="small" class="text-icon-strong" />
        <div class="text-12-medium uppercase tracking-[0.08em] text-text-weak">{props.title}</div>
        <div class="text-12-regular text-text-muted">({props.items.length})</div>
      </div>
      <Show when={props.items.length > 0}>
        <div class="flex flex-col gap-1.5">
          <For each={props.items}>
            {(item) => (
              <div class="flex items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-2 py-2">
                <IconButton
                  icon="arrow-up"
                  size="small"
                  variant="ghost"
                  class="disabled:opacity-40"
                  disabled={item.disableUp}
                  onClick={() => props.onMoveUp(item.id)}
                  aria-label={language.t("session.followupDock.moveUp")}
                />
                <IconButton
                  icon="arrow-down-to-line"
                  size="small"
                  variant="ghost"
                  class="disabled:opacity-40"
                  disabled={item.disableDown}
                  onClick={() => props.onMoveDown(item.id)}
                  aria-label={language.t("session.followupDock.moveDown")}
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-13-regular text-text-strong">{item.text}</div>
                  <Show when={item.editing}>
                    <div class="text-12-regular text-text-weak">{language.t("session.followupDock.editingState")}</div>
                  </Show>
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={item.disableMoveLane}
                  onClick={() => props.onMoveLane(item.id)}
                >
                  {props.moveLabel}
                </Button>
                <Tooltip placement="top" inactive={!item.editHint} value={item.editHint ?? ""}>
                  <div>
                    <IconButton
                      icon="pencil-line"
                      size="small"
                      variant="ghost"
                      disabled={item.disableEdit}
                      onClick={() => props.onEdit(item.id)}
                      aria-label={language.t("session.followupDock.edit")}
                    />
                  </div>
                </Tooltip>
                <IconButton
                  icon="trash"
                  size="small"
                  variant="ghost"
                  disabled={item.disableDelete}
                  onClick={() => props.onDelete(item.id)}
                  aria-label={language.t("common.delete")}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
