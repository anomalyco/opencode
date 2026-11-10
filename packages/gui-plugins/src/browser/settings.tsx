import { createMemo, createSignal, For, Show, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createLatest, usePlugin, type IconName } from "@opencode/plugin/gui"
import { choiceLabel, choiceValue, Glyph, profileChoices, type Choice } from "./choices"
import type definition from "./index"
import { createProfileJobs, type JobMessage } from "./jobs"
import type { ProfileExtension, ProfileSource } from "./profile/ipc"

/**
 * Settings › Browser: whether links open in the pane, importing sign-ins, the extensions the profile runs, and its
 * stored data. Every action goes through the jobs machine, so one runs at a time and each says how it ended beside
 * the control that started it.
 */
export default function BrowserSettings() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const desktop = ctx.desktop
  const preferences = ctx.stores.preferences
  // How each browser's import ended, by choice, kept while the page is open so every row keeps its own answer.
  const [results, setResults] = createSignal<ReadonlyMap<string, JobMessage>>(new Map())

  const jobs = createProfileJobs({
    finished(finished) {
      const job = finished.job
      const message = jobs.describe(finished)

      if (job.type !== "import-browser" || !message) return
      setResults((current) => new Map(current).set(resultKey(job.source, job.profile), message))
    },
  })

  const choices = createMemo(() => profileChoices(jobs.sources()))
  const blocked = () => !jobs.available() || jobs.running() !== undefined

  const importing = (choice: Choice) => {
    const job = jobs.running()

    return job?.type === "import-browser" && job.source === choice.source.id && job.profile === choice.profile.id
  }

  // The file import and the sign-out say how they ended in their own rows.
  const fileMessage = () => (jobs.last()?.job.type === "import-file" ? jobs.describe(jobs.last()) : undefined)
  const clearMessage = () => (jobs.last()?.job.type === "clear" ? jobs.describe(jobs.last()) : undefined)

  const pickFile = async () => {
    const [file] =
      (await desktop?.pick({ title: ctx.t("settings.import.file.pick"), extensions: ["txt", "json"] })) ?? []

    if (file) jobs.start({ type: "import-file", path: file })
  }

  const addExtension = () =>
    ctx.dialogs.open((dialog) => <AddExtension sources={jobs.sources()} close={() => dialog.close()} />)

  return (
    <ui.SettingsLayout title={ctx.t("settings.title")} description={ctx.t("settings.description")}>
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
      <ui.SettingsSection title={ctx.t("settings.import.title")} footer={<Note>{ctx.t("settings.import.note")}</Note>}>
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
                  message={
                    importing(choice) ? undefined : results().get(resultKey(choice.source.id, choice.profile.id))
                  }
                />
              }
            >
              <ui.Button
                size="small"
                disabled={blocked()}
                busy={importing(choice)}
                onClick={() =>
                  jobs.start({ type: "import-browser", source: choice.source.id, profile: choice.profile.id })
                }
              >
                {ctx.t("settings.import.action")}
              </ui.Button>
            </ui.SettingsRow>
          )}
        </For>
        <Show when={jobs.sourcesLoaded() && choices().length === 0}>
          <ui.SettingsRow id="settings-browser-import" title={<Muted>{ctx.t("settings.import.none")}</Muted>} />
        </Show>
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
            disabled={blocked() || !desktop}
            busy={jobs.running()?.type === "import-file"}
            onClick={() => void pickFile()}
          >
            {ctx.t("settings.import.file.action")}
          </ui.Button>
        </ui.SettingsRow>
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
      <ui.SettingsSection title={ctx.t("settings.data.title")}>
        <ui.SettingsRow
          id="settings-browser-cookies"
          title={ctx.t("settings.cookies.title")}
          description={
            <Show
              when={clearMessage()}
              fallback={
                <Show when={jobs.summary()}>{(value) => ctx.plural("settings.cookies.count", value().cookies)}</Show>
              }
            >
              {(message) => message().text}
            </Show>
          }
        >
          <ui.Button
            size="small"
            variant="danger"
            disabled={blocked() || !jobs.summary()?.cookies}
            busy={jobs.running()?.type === "clear"}
            onClick={() => jobs.start({ type: "clear" })}
          >
            {ctx.t("settings.cookies.clear")}
          </ui.Button>
        </ui.SettingsRow>
      </ui.SettingsSection>
    </ui.SettingsLayout>
  )
}

function ExtensionRow(props: {
  extension: ProfileExtension
  disabled: boolean
  onEnable: (enabled: boolean) => void
  onRemove: () => void
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  return (
    <ui.SettingsRow
      title={
        <Identity
          image={props.extension.icon}
          fallback="extensions"
          name={props.extension.name}
          detail={props.extension.version}
          message={props.extension.error ? { text: props.extension.error, error: true } : undefined}
        />
      }
    >
      <div class="flex items-center gap-2">
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
          disabled={props.disabled}
          onChange={props.onEnable}
        />
      </div>
    </ui.SettingsRow>
  )
}

/**
 * The Add an extension dialog: a store link, the extensions another Chromium browser has, or an unpacked folder. It
 * runs its own jobs, so it keeps working whichever page opened it, and stays open to add several.
 */
function AddExtension(props: { sources: readonly ProfileSource[]; close: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const desktop = ctx.desktop
  const jobs = createProfileJobs()
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
      size={choices().length > 0 ? "normal" : "fit"}
      footer={
        <>
          <ui.Button
            variant="ghost"
            disabled={blocked() || !desktop}
            busy={jobs.running()?.type === "install-folder"}
            onClick={() => void pickFolder()}
          >
            {ctx.t("settings.extensions.folder.action")}
          </ui.Button>
          <ui.Button variant="contrast" onClick={props.close}>
            {ctx.t("settings.extensions.done")}
          </ui.Button>
        </>
      }
    >
      <div class="flex flex-col gap-4 pb-1">
        <div class="flex items-center gap-2">
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
        <Show when={jobs.describe(jobs.last())}>
          {(message) => (
            <p
              role={message().error ? "alert" : "status"}
              class="text-[13px] leading-[var(--line-height-base)]"
              classList={{ "text-v2-state-fg-danger": message().error, "text-v2-text-text-muted": !message().error }}
            >
              {message().text}
            </p>
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
                  <div class="flex h-9 items-center gap-3">
                    <Glyph image={item.icon} fallback="extensions" />
                    <span class="min-w-0 flex-1 truncate text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base">
                      {item.name}
                    </span>
                    <ui.Button
                      size="small"
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
                      {item.installed ? ctx.t("settings.extensions.added") : ctx.t("settings.extensions.add")}
                    </ui.Button>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </ui.Dialog>
  )
}

/** A row's subject: its icon, its name, and under it a detail or what the last action on it did. */
function Identity(props: { image?: string; fallback: IconName; name: string; detail?: string; message?: JobMessage }) {
  return (
    <span class="flex min-w-0 items-center gap-3">
      <Glyph image={props.image} fallback={props.fallback} />
      <span class="flex min-w-0 flex-col gap-1">
        <span class="truncate">{props.name}</span>
        <Show when={props.message} fallback={<Show when={props.detail}>{(detail) => <Muted>{detail()}</Muted>}</Show>}>
          {(message) => (
            <span
              role={message().error ? "alert" : "status"}
              class="text-[13px] font-[440] leading-[var(--line-height-base)]"
              classList={{ "text-v2-state-fg-danger": message().error, "text-v2-text-text-muted": !message().error }}
            >
              {message().text}
            </span>
          )}
        </Show>
      </span>
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
