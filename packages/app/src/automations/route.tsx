import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, For, Show } from "solid-js"
import { AutomationInspector, AutomationListRow } from "./view"
import { CollapsedSidebarToggleSpace } from "@/shell/sidebar-toggle"
import type { AutomationFilter } from "./format"
import { type AutomationItem, createAutomationsController } from "./model"

export function AutomationsScreen() {
  const controller = createAutomationsController()
  const dialog = useDialog()
  const language = controller.language

  const filters = createMemo((): { id: AutomationFilter; label: string; count: number }[] => [
    { id: "all", label: language.t("automations.filter.all"), count: controller.counts().all },
    { id: "active", label: language.t("automations.filter.active"), count: controller.counts().active },
    { id: "paused", label: language.t("automations.filter.paused"), count: controller.counts().paused },
    { id: "done", label: language.t("automations.filter.done"), count: controller.counts().done },
  ])

  function confirmDelete(entry: AutomationItem) {
    const name = entry.row.name
    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("automations.delete.title")}
            description={language.t("automations.delete.confirm", { name })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              void controller.update(entry, "delete")
              dialog.close()
            }}
          >
            {language.t("automations.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  return (
    <div
      data-slot="automations-panel"
      class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div
        data-slot="automations-header"
        data-tauri-drag-region
        class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-2.5"
      >
        <CollapsedSidebarToggleSpace />
        <div class="flex min-w-0 items-center gap-2">
          <Icon name="clock" class="shrink-0 text-v2-icon-icon-muted" />
          <h1 class="truncate text-[14px] leading-5 font-medium text-v2-text-text-base">
            {language.t("automations.title")}
          </h1>
        </div>

        <div
          role="tablist"
          aria-label={language.t("automations.title")}
          class="ms-2 hidden items-center gap-0.5 rounded-[7px] bg-v2-background-bg-layer-01 p-0.5 sm:flex"
        >
          <For each={filters()}>
            {(item) => {
              const active = () => controller.state.filter === item.id

              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  data-filter={item.id}
                  data-state={active() ? "active" : undefined}
                  class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12px] leading-4 text-v2-text-text-muted transition-colors hover:text-v2-text-text-base data-[state=active]:bg-v2-background-bg-layer-02 data-[state=active]:font-medium data-[state=active]:text-v2-text-text-base"
                  onClick={() => controller.setFilter(item.id)}
                >
                  <span>{item.label}</span>
                  <Show when={item.count > 0}>
                    <span class="tabular-nums text-v2-text-text-faint">{item.count}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>

        <div class="ms-auto flex items-center gap-1.5">
          <div class="relative hidden w-48 items-center md:flex lg:w-60">
            <Icon
              name="magnifying-glass"
              size="small"
              class="pointer-events-none absolute start-2 text-v2-icon-icon-muted"
            />
            <input
              type="search"
              value={controller.state.query}
              onInput={(event) => controller.setQuery(event.currentTarget.value)}
              placeholder={language.t("automations.search")}
              aria-label={language.t("automations.search")}
              class="h-7 w-full rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 ps-7 pe-2 text-[12px] leading-4 text-v2-text-text-base placeholder:text-v2-text-text-faint focus:border-v2-border-border-strong focus:outline-none"
            />
          </div>

          <Tooltip placement="bottom" value={language.t("automations.refresh")}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="normal"
              icon={<Icon name="refresh" size="small" />}
              aria-label={language.t("automations.refresh")}
              onClick={controller.refresh}
            />
          </Tooltip>

          <Show when={controller.draftTarget()}>
            <Button
              type="button"
              variant="contrast"
              size="small"
              data-action="automations-new"
              onClick={() => controller.openNewAutomation()}
            >
              <Icon name="plus-small" size="small" />
              <span>{language.t("automations.new")}</span>
            </Button>
          </Show>
        </div>
      </div>

      <Show
        when={controller.entries().length > 0}
        fallback={
          <div class="mx-auto flex max-w-[480px] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Icon name="clock" class="text-v2-icon-icon-muted" />
            <h2 class="text-14-medium text-v2-text-text-base">
              {language.t(
                !controller.available()
                  ? "automations.unavailable"
                  : controller.failed()
                    ? "automations.failed"
                    : controller.loading()
                      ? "automations.loading"
                      : "automations.empty.title",
              )}
            </h2>
            <Show when={controller.draftTarget() && !controller.loading() && !controller.failed()}>
              <p class="text-13-regular text-v2-text-text-muted">{language.t("automations.empty.description")}</p>
              <Button
                size="small"
                onClick={() => controller.openNewAutomation(`/automation ${language.t("automations.example")}`)}
              >
                {language.t("automations.example")}
              </Button>
            </Show>
          </div>
        }
      >
        <div class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-v2-border-border-base lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] lg:divide-x lg:divide-y-0 rtl:divide-x-reverse">
          <div data-scrollable class="min-h-0 overflow-y-auto">
            <div class="flex flex-col gap-0.5 p-2">
              <Show
                when={controller.filtered().length > 0}
                fallback={
                  <div class="px-3 py-8 text-center text-[13px] leading-5 text-v2-text-text-faint">
                    {language.t("automations.empty.filtered")}
                  </div>
                }
              >
                <For each={controller.filtered()}>
                  {(entry) => (
                    <AutomationListRow
                      entry={entry}
                      selected={controller.selected()?.key === entry.key}
                      multiServer={controller.multiServer()}
                      onSelect={() => controller.select(entry.key)}
                    />
                  )}
                </For>
              </Show>
            </div>
          </div>

          <div data-scrollable class="min-h-0 overflow-y-auto">
            <Show when={controller.selected()}>
              {(entry) => (
                <AutomationInspector
                  entry={entry()}
                  busy={controller.busy()}
                  onTogglePause={() => controller.update(entry(), entry().row.status === "paused" ? "resume" : "pause")}
                  onOpenSession={(id) => controller.openSession(entry(), id)}
                  onDelete={() => confirmDelete(entry())}
                />
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
