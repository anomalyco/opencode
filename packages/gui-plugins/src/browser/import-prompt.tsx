import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { choiceLabel, Glyph, profileChoices, type Choice } from "./choices"
import type definition from "./index"
import { createProfileJobs } from "./jobs"
import { importedCookies } from "./jobs-machine"

/**
 * The pane's offer to bring sign-ins from the browser the user already uses, until they import or decline once. A
 * `bar` sits above a page, where a signed-out site is the reason to import; a `card` sits on the new tab page.
 * Nothing shows where no other browser is installed, or while main's profile is away.
 *
 * `imported` runs once cookies came in, for the pane to load its page again with them.
 */
export function SignInOffer(props: { variant: "bar" | "card"; imported: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const preferences = ctx.stores.preferences

  const jobs = createProfileJobs({
    finished(finished) {
      const count = importedCookies(finished.outcome)

      if (count === 0 || finished.job.type !== "import-browser") return
      const job = finished.job
      const browser = choices().find((choice) => choice.source.id === job.source)?.source.name ?? ""
      showToast({ title: ctx.plural("signins.imported.from", count, { browser }) })
      props.imported()
    },
  })

  const choices = createMemo(() => profileChoices(jobs.sources()))
  const blocked = () => !jobs.available() || jobs.running() !== undefined
  const message = () => jobs.describe(jobs.last())
  const decline = () => preferences.set({ ...preferences.value, welcomed: true })
  const settings = () => ctx.layout.settings("browser")

  const run = (choice: Choice) =>
    jobs.start({ type: "import-browser", source: choice.source.id, profile: choice.profile.id })

  const importing = (choice: Choice) => {
    const job = jobs.running()

    return job?.type === "import-browser" && job.source === choice.source.id && job.profile === choice.profile.id
  }

  return (
    <Show when={choices()[0]}>
      {(first) => (
        <Show
          when={props.variant === "bar"}
          fallback={
            <section
              data-component="browser-signins"
              aria-label={ctx.t("signins.title")}
              class="mx-auto flex w-full max-w-[608px] flex-col gap-3 px-6 pt-12"
            >
              <div class="flex flex-col gap-1">
                <div class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                  {ctx.t("signins.title")}
                </div>
                <div class="text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted">
                  {ctx.t("signins.description")}
                </div>
              </div>
              <div class="flex flex-col rounded-[8px] bg-v2-background-bg-layer-01 px-3 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)]">
                <For each={choices()}>
                  {(choice) => (
                    <div class="flex h-11 items-center gap-3 border-b-[0.5px] border-v2-border-border-base last:border-b-0">
                      <Glyph image={choice.source.icon} fallback="outline-globe" />
                      <span class="min-w-0 flex-1 truncate text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                        {choiceLabel(choice)}
                      </span>
                      <ui.Button size="small" disabled={blocked()} busy={importing(choice)} onClick={() => run(choice)}>
                        {ctx.t("signins.action")}
                      </ui.Button>
                    </div>
                  )}
                </For>
              </div>
              <Show when={message()}>
                {(current) => (
                  <p role="alert" class="text-[13px] leading-[var(--line-height-base)] text-v2-state-fg-danger">
                    {current().text}
                  </p>
                )}
              </Show>
              <div class="flex items-center gap-1">
                <ui.Button size="small" variant="ghost" onClick={decline}>
                  {ctx.t("signins.dismiss")}
                </ui.Button>
                <ui.Button size="small" variant="ghost-muted" onClick={settings}>
                  {ctx.t("signins.more")}
                </ui.Button>
              </div>
            </section>
          }
        >
          <section
            data-component="browser-signins"
            aria-label={ctx.t("signins.title")}
            class="flex shrink-0 items-center gap-3 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2"
          >
            <Glyph image={first().source.icon} fallback="outline-globe" />
            <Show
              when={message()}
              fallback={
                <p class="min-w-0 flex-1 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base">
                  {ctx.t("signins.bar")}
                </p>
              }
            >
              {(current) => (
                <p
                  role="alert"
                  class="min-w-0 flex-1 text-[13px] leading-[var(--line-height-compact)] text-v2-state-fg-danger"
                >
                  {current().text}
                </p>
              )}
            </Show>
            <div class="flex shrink-0 items-center gap-1">
              <ui.Button
                size="small"
                variant="contrast"
                disabled={blocked()}
                busy={importing(first())}
                onClick={() => run(first())}
              >
                {ctx.t("signins.import", { browser: choiceLabel(first()) })}
              </ui.Button>
              <Menu gutter={4} modal={false} placement="bottom-end">
                <Tooltip placement="top" value={ctx.t("signins.other")}>
                  <Menu.Trigger
                    as={IconButton}
                    variant="ghost-muted"
                    size="large"
                    icon={<Icon name="outline-chevron-down" />}
                    aria-label={ctx.t("signins.other")}
                  />
                </Tooltip>
                <Menu.Portal>
                  <Menu.Content class="w-[220px]">
                    <For each={choices().slice(1)}>
                      {(choice) => (
                        <Menu.Item disabled={blocked()} onSelect={() => run(choice)}>
                          <Glyph image={choice.source.icon} fallback="outline-globe" class="!size-4" />
                          <span class="min-w-0 truncate">{choiceLabel(choice)}</span>
                        </Menu.Item>
                      )}
                    </For>
                    <Show when={choices().length > 1}>
                      <Menu.Separator />
                    </Show>
                    <Menu.Item onSelect={settings}>{ctx.t("signins.more")}</Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
              <Tooltip placement="top" value={ctx.t("signins.dismiss")}>
                <IconButton
                  variant="ghost-muted"
                  size="large"
                  icon={<Icon name="close" />}
                  aria-label={ctx.t("signins.dismiss")}
                  onClick={decline}
                />
              </Tooltip>
            </div>
          </section>
        </Show>
      )}
    </Show>
  )
}
