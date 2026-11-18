import { createMemo, createSignal, For, getOwner, runWithOwner, Show, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createLatest, usePlugin, type IconName } from "@opencode/plugin/gui"
import { choiceLabel, choiceValue, Glyph, profileChoices, type Choice } from "./choices"
import { accessSummary, advancedOpen, unvettedSource, verdict } from "./settings-view"
import { SiteChooser } from "./site-chooser"
import type definition from "./index"
import { createProfileJobs, type JobMessage } from "./jobs"
import type { ExtensionCompatibility, InstallResult, ProfileExtension, ProfileSource } from "./profile/ipc"
import { displayHost } from "./host-display"
import { BrowserSites } from "./site-permissions"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { showToast } from "@opencode/ui/toast"
import type { Job } from "./jobs-machine"

/**
 * Settings › Browser: importing sign-ins, the extensions the profile runs and whether links open in the pane; then,
 * under Advanced, sharing with remote servers, the agent's pages, the cookie-file import, site permissions and stored
 * data. Every action goes through the jobs machine, so one runs at a time and each says how it ended beside
 * the control that started it.
 */
export default function BrowserSettings(props: { target?: string }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const desktop = ctx.desktop
  const preferences = ctx.stores.preferences
  // How each browser's import ended, by choice, kept while the page is open so every row keeps its own answer.
  const [results, setResults] = createSignal<ReadonlyMap<string, JobMessage>>(new Map())
  // Advanced is closed until the person opens it, which this device remembers; a settings search that lands on one of
  // its rows shows it open as the page arrives. After that the person's own toggle wins: the search's target stays set
  // for the whole visit, so the one they closed it over no longer opens it.
  const [closedOver, setClosedOver] = createSignal<string>()
  const advanced = () => advancedOpen(preferences.value.advanced, props.target === closedOver() ? undefined : props.target)

  const jobs = createProfileJobs({
    cookies: true,
    finished(finished) {
      const job = finished.job
      const message = jobs.describe(finished)

      if (job.type !== "import-browser" || !message) return
      setResults((current) => new Map(current).set(resultKey(job.source, job.profile), message))
    },
  })

  const choices = createMemo(() => profileChoices(jobs.sources()))
  const blocked = () => !jobs.available() || jobs.running() !== undefined
  // Imported sign-ins that cannot be saved would be gone at the next start.
  const unsaved = () => jobs.unsaved() !== undefined

  // The file import and the sign-out say how they ended in their own rows.
  const fileMessage = () => (jobs.last()?.job.type === "import-file" ? jobs.describe(jobs.last()) : undefined)
  const clearMessage = () => (jobs.last()?.job.type === "clear" ? jobs.describe(jobs.last()) : undefined)

  const pickFile = async () => {
    const [file] =
      (await desktop?.pick({ title: ctx.t("settings.import.file.pick"), extensions: ["txt", "json"] })) ?? []

    if (file) jobs.start({ type: "import-file", path: file })
  }

  // The dialog's import is one of this page's jobs, whose row says how it ended, so the dialog goes with the page.
  const owner = getOwner()

  const chooseSites = (choice: Choice) =>
    runWithOwner(owner, () =>
      ctx.dialogs.open((dialog) => <SiteChooser choices={choices()} initial={choice} jobs={jobs} close={() => dialog.close()} />),
    )

  const addExtension = () =>
    ctx.dialogs.open((dialog) => <AddExtension sources={jobs.sources()} close={() => dialog.close()} />)

  // The browser pane, its profile and its extensions exist only in the desktop app, which is fixed for the page's life.
  if (!desktop)
    return (
      <ui.SettingsLayout title={ctx.t("settings.title")}>
        <ui.SettingsSection>
          <ui.SettingsRow title={<Muted>{ctx.t("settings.unavailable")}</Muted>} />
        </ui.SettingsSection>
      </ui.SettingsLayout>
    )

  // What most people come for is first: bring sign-ins, add extensions, and where links open. The rest waits in
  // one closed "Advanced" section.
  return (
    <ui.SettingsLayout title={ctx.t("settings.title")}>
      <ui.SettingsSection title={ctx.t("settings.import.title")} footer={<Note>{ctx.t("settings.import.note")}</Note>}>
        <Show when={jobs.unsaved()}>
          {(message) => (
            <ui.SettingsRow
              title={
                <span
                  role="alert"
                  class="text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-state-fg-danger"
                >
                  {message().text}
                </span>
              }
            />
          )}
        </Show>
        <For each={choices()}>
          {(choice, index) => (
            <ui.SettingsRow
              id={index() === 0 ? "settings-browser-import" : undefined}
              title={
                <Identity
                  image={choice.source.icon}
                  fallback="outline-globe"
                  name={choice.source.name}
                  detail={choice.source.profiles.length > 1 ? choice.profile.name : undefined}
                  keep
                  message={
                    jobs.importing(choice) ? jobs.notice() : results().get(resultKey(choice.source.id, choice.profile.id))
                  }
                />
              }
            >
              {/* One action: its dialog brings everything, or lets the person choose sites. */}
              <ui.Button size="small" disabled={blocked() || unsaved()} busy={jobs.importing(choice)} onClick={() => chooseSites(choice)}>
                {ctx.t("settings.import.open")}
              </ui.Button>
            </ui.SettingsRow>
          )}
        </For>
        <Show when={jobs.sourcesLoaded() && choices().length === 0}>
          <ui.SettingsRow id="settings-browser-import" title={<Muted>{ctx.t("settings.import.none")}</Muted>} />
        </Show>
      </ui.SettingsSection>
      <ui.SettingsSection
        title={ctx.t("settings.extensions.title")}
        footer={<Note>{ctx.t("settings.extensions.note")}</Note>}
      >
        <For each={jobs.extensions()}>
          {(extension) => (
            <ExtensionRow
              extension={extension}
              disabled={blocked()}
              onEnable={(enabled) => jobs.start({ type: "enable", id: extension.id, enabled })}
              onRemove={() => jobs.start({ type: "remove", id: extension.id })}
            />
          )}
        </For>
        <ui.SettingsRow
          id="settings-browser-extensions"
          title={ctx.t("settings.extensions.add.title")}
          description={ctx.t("settings.extensions.add.description")}
        >
          <ui.Button size="small" icon="plus" disabled={!jobs.available()} onClick={addExtension}>
            {ctx.t("settings.extensions.add.action")}
          </ui.Button>
        </ui.SettingsRow>
      </ui.SettingsSection>
      <ui.SettingsSection>
        <ui.SettingsRow
          id="settings-browser-links"
          title={ctx.t("settings.links.title")}
          description={ctx.t("settings.links.description")}
        >
          <ui.Switch
            label={ctx.t("settings.links.title")}
            hideLabel
            checked={preferences.value.links}
            onChange={(links) => preferences.set({ ...preferences.value, links })}
          />
        </ui.SettingsRow>
      </ui.SettingsSection>
      {/* A section heading like the others, with no card, that is a button: the whole row opens and closes it. The
          chevron ends the line's text, as in the other disclosures: after the summary while closed, after the heading
          while open. A summary too long for the window is cut short, so the chevron never wraps or leaves its word. */}
      <section class="settings-section">
        <h3 class="settings-section-title">
          <button
            type="button"
            data-action="settings-browser-advanced"
            aria-expanded={advanced()}
            class="group flex w-full items-center gap-1 rounded-[4px] text-start outline-none focus-visible:shadow-[0_0_0_1px_var(--v2-border-border-focus)]"
            style={{ font: "inherit", color: "inherit", "letter-spacing": "inherit" }}
            onClick={() => {
              const open = !advanced()

              setClosedOver(open ? undefined : props.target)
              preferences.update((draft) => {
                draft.advanced = open
              })
            }}
          >
            <span class="shrink-0">{ctx.t("settings.advanced")}</span>
            <Show when={!advanced()}>
              <span class="ms-2 min-w-0 truncate font-[440] text-v2-text-text-muted">{ctx.t("settings.advanced.summary")}</span>
            </Show>
            <span class={ADVANCED_CHEVRON}>
              <ui.Icon name={advanced() ? "outline-chevron-down" : "outline-chevron-right"} />
            </span>
          </button>
        </h3>
      </section>
      <Show when={advanced()}>
        <ui.SettingsSection>
          <ui.SettingsRow
            id="settings-browser-remote"
            title={ctx.t("settings.remote.title")}
            description={ctx.t("settings.remote.description")}
          >
            <ui.Switch
              label={ctx.t("settings.remote.title")}
              hideLabel
              checked={jobs.remoteSignIns() ?? false}
              disabled={jobs.remoteSignIns() === undefined}
              onChange={jobs.shareSignIns}
            />
          </ui.SettingsRow>
          <ui.SettingsRow
            id="settings-browser-agent-pages"
            title={ctx.t("settings.agentPages.title")}
            description={ctx.t("settings.agentPages.description")}
          >
            <ui.Switch
              label={ctx.t("settings.agentPages.title")}
              hideLabel
              checked={preferences.value.agentPages !== false}
              onChange={(agentPages) =>
                preferences.update((draft) => {
                  draft.agentPages = agentPages
                })
              }
            />
          </ui.SettingsRow>
        </ui.SettingsSection>
        <ui.SettingsSection>
          <ui.SettingsRow
            title={
              <Identity
                fallback="file-document"
                name={ctx.t("settings.import.file.title")}
                detail={ctx.t("settings.import.file.description")}
                message={fileMessage()}
              />
            }
          >
            <ui.Button
              size="small"
              disabled={blocked() || unsaved() || !desktop}
              busy={jobs.running()?.type === "import-file"}
              onClick={() => void pickFile()}
            >
              {ctx.t("settings.import.file.action")}
            </ui.Button>
          </ui.SettingsRow>
        </ui.SettingsSection>
        <SitePermissionsSection />
        <ui.SettingsSection title={ctx.t("settings.data.title")}>
          <ui.SettingsRow
            id="settings-browser-cookies"
            title={ctx.t("settings.cookies.title")}
            description={
              <Show
                when={clearMessage()}
                fallback={
                  // Show runs its children once; the count lives in an expression so a new summary updates it.
                  <Show when={jobs.summary()}>{(value) => <>{ctx.plural("settings.cookies.count", value().cookies)}</>}</Show>
                }
              >
                {(message) => message().text}
              </Show>
            }
          >
            <ui.Button
              size="small"
              variant="danger"
              // HTTP sign-ins have no count to show, so signing out stays possible with no cookies.
              disabled={blocked()}
              busy={jobs.running()?.type === "clear"}
              onClick={() => jobs.start({ type: "clear" })}
            >
              {ctx.t("settings.cookies.clear")}
            </ui.Button>
          </ui.SettingsRow>
        </ui.SettingsSection>
      </Show>
    </ui.SettingsLayout>
  )
}

/** The Advanced heading's chevron: faint at rest, full strength under the pointer and on keyboard focus. */
const ADVANCED_CHEVRON = "flex shrink-0 opacity-40 group-hover:opacity-100 group-focus-visible:opacity-100 rtl:-scale-x-100"

/**
 * The decisions the user kept for sites, one row per site and feature: the site, the feature under it, and its setting
 * beside a remove button, in columns that line up whatever the names' length.
 */
function SitePermissionsSection() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const live = ctx.use(BrowserSites)

  const client = () => {
    const current = live()

    return current.status === "active" ? current.value : undefined
  }

  const decisions = () => client()?.state()?.decisions ?? []
  // The end of a long host is the site's own domain: shown whole, wrapping, never cut off at the end.
  const site = (origin: string) => displayHost(origin) || origin
  const failed = () => showToast({ title: ctx.t("settings.sites.failed") })

  return (
    <ui.SettingsSection
      title={ctx.t("settings.sites.title")}
      footer={<Note>{ctx.t("settings.sites.note")}</Note>}
    >
      <For each={decisions()} fallback={<ui.SettingsRow id="settings-browser-sites" title={<Muted>{ctx.t("settings.sites.none")}</Muted>} />}>
        {(decision, index) => {
          const names = () => ({
            permission: ctx.t(`settings.sites.permission.${decision.permission}`),
            site: site(decision.origin),
          })

          return (
            <ui.SettingsRow
              id={index() === 0 ? "settings-browser-sites" : undefined}
              title={
                <span class="flex min-w-0 items-center gap-3">
                  <Glyph fallback="outline-globe" />
                  <span class="flex min-w-0 flex-col gap-1">
                    <span dir="ltr" class="[overflow-wrap:anywhere]">{site(decision.origin)}</span>
                    <Muted>{names().permission}</Muted>
                  </span>
                </span>
              }
            >
              <div class="flex items-center gap-2">
                <ui.Select
                  class={SETTING_COLUMN}
                  label={ctx.t("settings.sites.setting", names())}
                  options={[
                    { value: "allow", label: ctx.t("settings.sites.allow") },
                    { value: "block", label: ctx.t("settings.sites.block") },
                  ]}
                  value={decision.setting}
                  disabled={!client()}
                  onChange={(setting) =>
                    void client()?.set({ origin: decision.origin, permission: decision.permission, setting }).catch(failed)
                  }
                />
                <ui.Tooltip value={ctx.t("settings.sites.remove", names())}>
                  <ui.IconButton
                    icon="outline-trash"
                    label={ctx.t("settings.sites.remove", names())}
                    disabled={!client()}
                    onClick={() =>
                      void client()?.remove({ origin: decision.origin, permission: decision.permission }).catch(failed)
                    }
                  />
                </ui.Tooltip>
              </div>
            </ui.SettingsRow>
          )
        }}
      </For>
    </ui.SettingsSection>
  )
}

/** A site permission's setting keeps one width whatever it says, so the remove buttons line up. */
const SETTING_COLUMN = "w-28"

function ExtensionRow(props: {
  extension: ProfileExtension
  disabled: boolean
  onEnable: (enabled: boolean) => void
  onRemove: () => void
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const message = () => {
    const text = props.extension.changed ? ctx.t("settings.extensions.changed") : props.extension.error

    return text ? { text, error: true } : undefined
  }

  return (
    <ui.SettingsRow
      title={
        <Identity
          image={props.extension.icon}
          fallback="puzzle"
          name={props.extension.name}
          detail={props.extension.version}
          message={message()}
        />
      }
    >
      <div class="flex items-center gap-2">
        <CompatibilityNote compatibility={props.extension.compatibility} />
        <ui.Tooltip value={ctx.t("settings.extensions.remove", { name: props.extension.name })}>
          <ui.IconButton
            icon="outline-trash"
            label={ctx.t("settings.extensions.remove", { name: props.extension.name })}
            disabled={props.disabled}
            onClick={props.onRemove}
          />
        </ui.Tooltip>
        <ui.Switch
          label={ctx.t("settings.extensions.enable", { name: props.extension.name })}
          hideLabel
          checked={props.extension.enabled}
          disabled={props.disabled || props.extension.changed}
          onChange={props.onEnable}
        />
      </div>
    </ui.SettingsRow>
  )
}

/**
 * The Add an extension dialog: a store link, or the extensions another Chromium browser has. Loading one from a folder
 * of its source files is for people who build extensions, so it waits in a closed "For developers" disclosure at the
 * end. The dialog runs its own jobs, so it keeps working whichever page opened it, and stays open to add several.
 */
function AddExtension(props: { sources: readonly ProfileSource[]; close: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const desktop = ctx.desktop
  // The page that opened it already lists the browsers.
  const jobs = createProfileJobs({ profile: false })
  const [form, setForm] = createStore<{ link: string; profile?: string }>({ link: "" })
  const choices = createMemo(() => profileChoices(props.sources.filter((source) => source.engine === "chromium")))
  const selected = createMemo(() => choices().find((choice) => choiceValue(choice) === form.profile) ?? choices()[0])
  const blocked = () => !jobs.available() || jobs.running() !== undefined

  // Read again after each job, so an extension just added shows as added.
  const available = createLatest(
    () => {
      const choice = selected()
      const key = jobs.key()

      return choice && key ? `${key}\n${choiceValue(choice)}` : undefined
    },
    (_value, signal) => {
      const choice = untrack(selected)

      return choice ? jobs.browserExtensions(choice.source.id, choice.profile.id, signal) : Promise.resolve([])
    },
  )

  const installing = (id: string) => {
    const job = jobs.running()

    return job?.type === "install-browser" && job.id === id
  }

  // The install that stopped for the user to confirm: its extension will not work here, or asks for access the user
  // has not seen yet.
  const confirming = () => {
    const last = jobs.last()

    if (last?.outcome.type !== "installed") return undefined

    if (last.outcome.result.type !== "unsupported" && last.outcome.result.type !== "review") return undefined
    const job = last.job
    const result = last.outcome.result

    return job.type === "install-store" || job.type === "install-folder" || job.type === "install-browser"
      ? { job, result }
      : undefined
  }

  const addLink = () => {
    const url = form.link.trim()

    if (!url || blocked()) return
    jobs.start({ type: "install-store", url })
    setForm("link", "")
  }

  const pickFolder = async () => {
    const [folder] = (await desktop?.pick({ title: ctx.t("settings.extensions.folder.pick"), directory: true })) ?? []

    if (folder) jobs.start({ type: "install-folder", path: folder })
  }

  return (
    <ui.Dialog
      title={ctx.t("settings.extensions.add.title")}
      description={ctx.t("settings.extensions.dialog.description")}
      // As tall as what it holds: a review and its details need room, and the list between scrolls when it is long.
      size="fit"
      footer={
        <ui.Button variant="contrast" onClick={props.close}>
          {ctx.t("settings.extensions.done")}
        </ui.Button>
      }
    >
      {/* The link and the developers' disclosure keep their place; what is between them scrolls when it is long. */}
      <div class="flex h-full min-h-0 flex-col gap-4 pb-1">
        <div class="flex shrink-0 items-center gap-2">
          <ui.TextInput
            label={ctx.t("settings.extensions.store.label")}
            placeholder={ctx.t("settings.extensions.store.placeholder")}
            type="url"
            size="large"
            autofocus
            value={form.link}
            onInput={(link) => setForm("link", link)}
            onSubmit={addLink}
            class="min-w-0 flex-1"
          />
          <ui.Button
            size="large"
            disabled={blocked() || !form.link.trim()}
            busy={jobs.running()?.type === "install-store"}
            onClick={addLink}
          >
            {ctx.t("settings.extensions.add")}
          </ui.Button>
        </div>
        {/* The scroller spans the dialog's own inset, so its thumb lies beside the rows and they keep their edges. */}
        <MenuScroll class="-mx-4 max-h-[50vh] min-h-0 flex-1" viewportClass="min-h-0 flex-1 px-4">
        <div class="flex flex-col gap-4">
        <Show when={jobs.describe(jobs.last())}>
          {(message) => (
            <div
              role={message().error ? "alert" : "status"}
              class="flex flex-col gap-2 text-[13px] leading-[var(--line-height-base)]"
            >
              <Show
                when={confirming()}
                fallback={
                  // An added extension's list of what does not work shows on hover, as in its row, so the list of
                  // browsers' extensions below keeps its room.
                  <Show
                    when={message().compatibility}
                    fallback={
                      <p
                        classList={{
                          "text-v2-state-fg-danger": message().error,
                          "text-v2-text-text-muted": !message().error,
                        }}
                      >
                        {message().text}
                      </p>
                    }
                  >
                    {(compatibility) => (
                      <ui.Tooltip value={<CompatibilityDetails compatibility={compatibility()} />}>
                        <p tabIndex={0} class="text-v2-text-text-muted">
                          {message().text}
                        </p>
                      </ui.Tooltip>
                    )}
                  </Show>
                }
              >
                {(confirm) => (
                  <ChoiceRow image={confirm().result.icon} name={confirm().result.name}>
                    <ui.Button
                      size="small"
                      class={ACTION_COLUMN}
                      disabled={blocked()}
                      onClick={() => jobs.start({ ...confirm().job, token: confirm().result.token })}
                    >
                      {confirm().result.type === "unsupported"
                        ? ctx.t("settings.extensions.anyway")
                        : ctx.t("settings.extensions.add")}
                    </ui.Button>
                  </ChoiceRow>
                )}
              </Show>
              <Show when={confirming()} keyed>
                {(confirm) => <InstallReview review={confirm.result} job={confirm.job} />}
              </Show>
            </div>
          )}
        </Show>
        <Show when={selected()}>
          {(choice) => (
            <div class="flex flex-col gap-1">
              <div class="flex h-7 items-center justify-between gap-2">
                <span class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                  {ctx.t("settings.extensions.browser.title")}
                </span>
                <Show when={choices().length > 1}>
                  <ui.Select
                    label={ctx.t("settings.extensions.browser.select")}
                    options={choices().map((item) => ({ value: choiceValue(item), label: choiceLabel(item) }))}
                    value={choiceValue(choice())}
                    onChange={(profile) => setForm("profile", profile)}
                  />
                </Show>
              </div>
              <For
                each={available.latest ?? []}
                fallback={
                  <Show when={available.latest}>
                    <Muted>{ctx.t("settings.extensions.browser.empty")}</Muted>
                  </Show>
                }
              >
                {(item) => (
                  <ChoiceRow image={item.icon} name={item.name}>
                    <CompatibilityNote compatibility={item.compatibility} />
                    <ui.Button
                      size="small"
                      class={ACTION_COLUMN}
                      variant={item.installed ? "ghost-muted" : "neutral"}
                      disabled={blocked() || item.installed}
                      busy={installing(item.id)}
                      onClick={() =>
                        jobs.start({
                          type: "install-browser",
                          source: choice().source.id,
                          profile: choice().profile.id,
                          id: item.id,
                        })
                      }
                    >
                      {item.installed
                        ? ctx.t("settings.extensions.added")
                        : item.compatibility.level === "unsupported"
                          ? ctx.t("settings.extensions.anyway")
                          : ctx.t("settings.extensions.add")}
                    </ui.Button>
                  </ChoiceRow>
                )}
              </For>
            </div>
          )}
        </Show>
        </div>
        </MenuScroll>
        <details class="group shrink-0 border-t-[0.5px] border-v2-border-border-muted pt-3 text-v2-text-text-muted">
          <summary class={DISCLOSURE}>
            {ctx.t("settings.developers")}
            <span class="flex transition-transform group-open:rotate-180">
              <ui.Icon name="outline-chevron-down" />
            </span>
          </summary>
          <div class="mt-2 flex items-center gap-3">
            <p class="min-w-0 flex-1 text-[13px] leading-[var(--line-height-base)]">
              {ctx.t("settings.extensions.folder.description")}
            </p>
            <ui.Button
              size="small"
              variant="neutral"
              disabled={blocked() || !desktop}
              busy={jobs.running()?.type === "install-folder"}
              onClick={() => void pickFolder()}
            >
              {ctx.t("settings.extensions.folder.action")}
            </ui.Button>
          </div>
        </details>
      </div>
    </ui.Dialog>
  )
}

/** A disclosure's summary: the app's own chevron in place of the browser's marker. */
const DISCLOSURE =
  "flex w-fit cursor-pointer list-none items-center gap-1 text-[13px] leading-[var(--line-height-base)] [&::-webkit-details-marker]:hidden"

/**
 * Buttons beside a verdict share one width whatever they say, so the verdicts' right edges line up in a column.
 */
const ACTION_COLUMN = "min-w-24 justify-center"

/** The verdict and action stay whole; only the name may truncate. */
function ChoiceRow(props: { image?: string; name: string; children: JSX.Element }) {
  return (
    <div class="flex h-11 items-center gap-3">
      <Glyph image={props.image} fallback="puzzle" />
      <span class="min-w-0 flex-1 truncate text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base" title={props.name}>{props.name}</span>
      {props.children}
    </div>
  )
}

function InstallReview(props: {
  review: Extract<InstallResult, { token: string }>
  job: Extract<Job, { type: "install-store" | "install-folder" | "install-browser" }>
}) {
  const ctx = usePlugin<typeof definition>()
  const [expanded, setExpanded] = createSignal(false)
  const more = () => props.review.sites.length - 3
  const grants = () => props.review.added ?? props.review

  const origin = () => {
    if (props.job.type === "install-folder") return props.job.path

    if (props.job.type === "install-browser") return ctx.t("review.profile", { source: props.job.source, profile: props.job.profile })
  }

  const source = () => props.review.store ?? (props.job.type === "install-browser" ? "browser" : "folder")

  const technical = () => [
    [ctx.t("review.id"), props.review.id],
    [ctx.t("review.origin"), origin()],
    [ctx.t("review.patterns"), props.review.hosts.join("\n")],
    [ctx.t("review.permissions"), props.review.permissions.join(", ")],
  ].filter((row) => row[1])

  return (
    <div class="flex min-w-0 flex-col gap-2 text-[13px] leading-[var(--line-height-base)] text-v2-text-text-base">
      <Verdict level={props.review.compatibility.level} />
      <p class="text-v2-text-text-muted">
        {ctx.t(accessSummary(props.review.access))}
        <Show when={props.review.access.length > 1}> {ctx.t("review.summary.more")}</Show>
      </p>
      {/* In sight, not behind Details: a copy no store checked is something to know before adding it. */}
      <Show when={unvettedSource(source())}>{(key) => <p>{ctx.t(key())}</p>}</Show>
      {/* An update that asks for more stays in sight: the person agreed to less. */}
      <Show when={props.review.added}>
        <div>
          <p class="font-[530] text-v2-state-fg-warning">{ctx.t("review.new")}</p>
          <ul class="list-disc ps-4">
            <For each={grants().access}>{(item) => <li>{ctx.t(item === "someSites" || item === "allSites" ? "review.changeSites" : `extensions.access.${item}`)}</li>}</For>
            <Show when={props.review.added?.hosts.length && !grants().access.some((item) => item === "someSites" || item === "allSites")}><li>{ctx.t("review.moreSites")}</li></Show>
            <Show when={!grants().access.length && !grants().hosts.length}><li>{ctx.t("review.morePermissions")}</li></Show>
          </ul>
        </div>
      </Show>
      <details class="group text-v2-text-text-muted">
        <summary class={DISCLOSURE}>
          {ctx.t("review.details")}
          <span class="flex transition-transform group-open:rotate-180">
            <ctx.ui.Icon name="outline-chevron-down" />
          </span>
        </summary>
        <div data-scrollable tabIndex={0} role="region" aria-label={ctx.t("review.details")} class="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto rounded-[6px] bg-v2-background-bg-layer-01 p-3 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)]">
          <Show when={props.review.access.length}>
            <div class="text-v2-text-text-base">
              <p class="font-[530]">{ctx.t("extensions.access.title")}</p>
              <ul class="list-disc ps-4">
                <For each={props.review.access}>{(item) => <li>{ctx.t(`extensions.access.${item}`)}</li>}</For>
              </ul>
            </div>
          </Show>
          <Show when={props.review.compatibility.level !== "supported"}>
            <div class="text-v2-text-text-base">
              <CompatibilityDetails compatibility={props.review.compatibility} />
            </div>
          </Show>
          <Show when={!unvettedSource(source())}><p>{ctx.t(`review.source.${source()}`)}</p></Show>
          <Show when={props.review.replaces}>{(name) => <p>{ctx.t("settings.extensions.replaces", { name: name() })}</p>}</Show>
          <Show when={props.review.access.includes("allSites")} fallback={
            <Show when={props.review.sites.length} fallback={<p>{ctx.t(props.review.hosts.length ? "review.otherSites" : "review.noSites")}</p>}>
              <p class="break-words">{ctx.t("review.sites")} <bdi dir="ltr">{(expanded() ? props.review.sites : props.review.sites.slice(0, 3)).join(", ")}</bdi>{" "}
                <Show when={more() > 0}><button type="button" aria-expanded={expanded()} class="underline" onClick={() => setExpanded(!expanded())}>
                  {expanded() ? ctx.t("review.less") : ctx.plural("review.more", more())}
                </button></Show>
              </p>
            </Show>
          }><p>{ctx.t("review.allSites")}</p></Show>
          <dl class="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[12px]">
            <For each={technical()}>{(row) => <><dt>{row[0]}</dt><dd dir="ltr" class="whitespace-pre-wrap break-all text-v2-text-text-base" style={{ "font-family": "var(--font-family-mono)" }}>{row[1]}</dd></>}</For>
          </dl>
        </div>
      </details>
    </div>
  )
}

/**
 * Whether an extension works in this browser, in one plain line with a status dot: it works, it may not fully work,
 * or it probably will not.
 */
function Verdict(props: { level: ExtensionCompatibility["level"] }) {
  const ctx = usePlugin<typeof definition>()

  return (
    <p data-verdict={props.level} class="flex items-center gap-2 font-[530]">
      <span
        aria-hidden="true"
        class="size-1.5 shrink-0 rounded-full"
        classList={{
          "bg-v2-state-fg-success": props.level === "supported",
          "bg-v2-state-fg-warning": props.level === "partial",
          "bg-v2-state-fg-danger": props.level === "unsupported",
        }}
      />
      {ctx.t(verdict(props.level))}
    </p>
  )
}

/**
 * A row's subject: its icon, its name, and under it a detail or what the last action on it did; with `keep`, the
 * detail stays before the message, so rows of one browser still say which profile each is.
 */
function Identity(props: {
  image?: string
  fallback: IconName
  name: string
  detail?: string
  keep?: boolean
  message?: JobMessage
}) {
  return (
    <span class="flex min-w-0 items-center gap-3">
      <Glyph image={props.image} fallback={props.fallback} />
      <span class="flex min-w-0 flex-col gap-1">
        <span class="truncate">{props.name}</span>
        <Show when={props.message} fallback={<Show when={props.detail}>{(detail) => <Muted>{detail()}</Muted>}</Show>}>
          {(message) => (
            <span class="text-[13px] font-[440] leading-[var(--line-height-base)]">
              <Show when={props.keep && props.detail}>{(detail) => <span class="text-v2-text-text-muted">{detail()} · </span>}</Show>
              <span
                role={message().error ? "alert" : "status"}
                classList={{ "text-v2-state-fg-danger": message().error, "text-v2-text-text-muted": !message().error }}
              >
                {message().text}
              </span>
            </span>
          )}
        </Show>
      </span>
    </span>
  )
}

/**
 * A quiet note for an extension that partly works here and a warning for one that will not, with what does not work
 * on hover or focus; nothing for one that works.
 */
function CompatibilityNote(props: { compatibility: ExtensionCompatibility }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const level = () => props.compatibility.level

  return (
    <Show when={level() !== "supported" ? level() : undefined}>
      {(shown) => (
        // The tooltip wraps its trigger in an element of its own, so this one keeps the note whole in a row.
        <span class="flex shrink-0 justify-end">
          <ui.Tooltip value={<CompatibilityDetails compatibility={props.compatibility} />}>
            <span
              data-compatibility={shown()}
              tabIndex={0}
              class="whitespace-nowrap text-end text-[13px] font-[440] leading-[var(--line-height-base)]"
              classList={{
                "text-v2-state-fg-warning": shown() === "unsupported",
                "text-v2-text-text-muted": shown() === "partial",
              }}
            >
              {ctx.t(shown() === "partial" ? "review.partial" : `extensions.compat.${shown()}`)}
            </span>
          </ui.Tooltip>
        </span>
      )}
    </Show>
  )
}

/** Why an extension will not work here, and each part of it that does not. */
function CompatibilityDetails(props: { compatibility: ExtensionCompatibility }) {
  const ctx = usePlugin<typeof definition>()

  return (
    <span class="flex flex-col gap-1">
      <Show when={props.compatibility.cause}>{(cause) => <span>{ctx.t(`extensions.compat.cause.${cause()}`)}</span>}</Show>
      <Show when={props.compatibility.missing.length > 0}>
        <span>{ctx.t("extensions.compat.missing")}</span>
        <For each={props.compatibility.missing}>
          {(feature) => <span class="ps-2">{ctx.t(`extensions.compat.feature.${feature}`)}</span>}
        </For>
      </Show>
    </span>
  )
}

function Muted(props: { children: JSX.Element }) {
  return (
    <span class="text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted">
      {props.children}
    </span>
  )
}

/** A line under a section's list, for what applies to every row in it. */
function Note(props: { children: JSX.Element }) {
  return <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">{props.children}</p>
}

function resultKey(source: string, profile: string) {
  return `${source}\n${profile}`
}
