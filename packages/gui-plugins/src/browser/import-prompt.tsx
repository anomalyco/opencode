import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, For, Show, type Accessor } from "solid-js"
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
 * Once cookies came in it says so, in place of the offer, until the user closes it: a page that loads again signed in is
 * the proof, and this names where the sign-ins came from.
 *
 * `imported` runs once cookies came in, for the pane to load its page again with them, and `closed` when the user
 * closes the confirmation.
 */
export function SignInOffer(props: { variant: "bar" | "card"; imported: () => void; closed: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const preferences = ctx.stores.preferences

  const jobs = createProfileJobs({
    finished(finished) {
      if (importedCookies(finished.outcome) > 0) props.imported()
    },
  })

  const choices = createMemo(() => profileChoices(jobs.sources()))
  const blocked = () => !jobs.available() || jobs.running() !== undefined
  const message = () => jobs.describe(jobs.last())

  // The import that brought cookies, with the browser's name, while its confirmation shows.
  const confirmed = createMemo(() => {
    const last = jobs.last()
    const count = last ? importedCookies(last.outcome) : 0

    if (!last || count === 0 || last.job.type !== "import-browser") return undefined
    const source = last.job.source

    return {
      count,
      choice: choices().find((choice) => choice.source.id === source),
    }
  })

  const decline = () => preferences.set({ ...preferences.value, welcomed: true })
  const settings = () => ctx.layout.settings("browser")

  const run = (choice: Choice) =>
    jobs.start({ type: "import-browser", source: choice.source.id, profile: choice.profile.id })

  const importing = (choice: Choice) => {
    const job = jobs.running()

    return job?.type === "import-browser" && job.source === choice.source.id && job.profile === choice.profile.id
  }

  return (
    <Show
      when={confirmed()}
      fallback={
        // Declined or already imported elsewhere: nothing more to offer.
        <Show when={preferences.value.welcomed ? undefined : choices()[0]}>{(first) => offer(first)}</Show>
      }
    >
      {(done) => (
        <div classList={{ "mx-auto w-full max-w-[608px] px-6 pt-12": props.variant === "card" }}>
          <section
            data-component="browser-signins"
            role="status"
            class="flex shrink-0 items-center gap-3 bg-v2-background-bg-layer-01 px-3 py-2"
            classList={{
              "border-b-[0.5px] border-v2-border-border-muted": props.variant === "bar",
              "rounded-[8px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)]": props.variant === "card",
            }}
          >
            <Glyph image={done().choice?.source.icon} fallback="outline-globe" />
            <Icon name="check" class="shrink-0 text-v2-state-fg-success" />
            <p class="min-w-0 flex-1 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base">
              {ctx.plural("signins.imported.from", done().count, { browser: done().choice?.source.name ?? "" })}
            </p>
            <Tooltip placement="top" value={ctx.t("common.close")}>
              <IconButton
                variant="ghost-muted"
                size="large"
                icon={<Icon name="close" />}
                aria-label={ctx.t("common.close")}
                onClick={() => {
                  jobs.dismiss()
                  props.closed()
                }}
              />
            </Tooltip>
          </section>
        </div>
      )}
    </Show>
  )

  function offer(first: Accessor<Choice>) {
    return (
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
    )
  }
}
