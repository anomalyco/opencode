import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { For, Show } from "solid-js"
import { AutomationInspector, AutomationListRow } from "./view"
import { CollapsedSidebarToggleSpace } from "@/shell/sidebar-toggle"
import { type AutomationItem, createAutomationsController } from "./model"

export function AutomationsScreen() {
  const controller = createAutomationsController()
  const dialog = useDialog()
  const language = controller.language

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
        <h1 class="truncate text-[14px] leading-5 font-medium text-v2-text-text-base">
          {language.t("automations.title")}
        </h1>

        <div class="ms-auto flex items-center gap-2">
          <input
            type="search"
            value={controller.state.query}
            onInput={(event) => controller.setQuery(event.currentTarget.value)}
            placeholder={language.t("automations.search")}
            aria-label={language.t("automations.search")}
            class="hidden h-7 w-44 rounded-[6px] bg-v2-background-bg-layer-01 px-2.5 text-[12px] leading-4 text-v2-text-text-base placeholder:text-v2-text-text-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-strong md:block lg:w-56"
          />

          <Show when={controller.draftTarget()}>
            <Button
              type="button"
              variant="contrast"
              size="small"
              data-action="automations-new"
              onClick={() => controller.openNewAutomation()}
            >
              {language.t("automations.new")}
            </Button>
          </Show>
        </div>
      </div>

      <Show
        when={controller.entries().length > 0}
        fallback={
          <div class="mx-auto flex max-w-[480px] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
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
                <For each={controller.groups()}>
                  {(group) => {
                    const done = () => group.status === "done"
                    const open = () => !done() || controller.state.showDone || !!controller.state.query.trim()

                    return (
                      <section class="flex flex-col gap-0.5 pb-3 last:pb-0">
                        <Show
                          when={done()}
                          fallback={
                            <h2 class="flex h-7 items-center gap-1.5 px-2.5 text-[12px] leading-4 text-v2-text-text-faint">
                              {language.t(`automations.status.${group.status}`)}
                              <span class="tabular-nums">{group.items.length}</span>
                            </h2>
                          }
                        >
                          <button
                            type="button"
                            aria-expanded={open()}
                            onClick={controller.toggleDone}
                            class="flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-start text-[12px] leading-4 text-v2-text-text-faint hover:text-v2-text-text-muted"
                          >
                            {language.t("automations.status.done")}
                            <span class="tabular-nums">{group.items.length}</span>
                            <span class="ms-auto">
                              {language.t(open() ? "automations.group.hide" : "automations.group.show")}
                            </span>
                          </button>
                        </Show>
                        <Show when={open()}>
                          <For each={group.items}>
                            {(entry) => (
                              <AutomationListRow
                                entry={entry}
                                selected={controller.selected()?.key === entry.key}
                                context={controller.context(entry)}
                                onSelect={() => controller.select(entry.key)}
                              />
                            )}
                          </For>
                        </Show>
                      </section>
                    )
                  }}
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
                  context={controller.context(entry())}
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
