import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { createLatest, usePlugin, type IpcClient } from "@opencode/plugin/gui"
import type definition from "./index"
import { BrowserProfile, type ProfileExtension, type ProfileSource } from "./profile/ipc"
import {
  initialSettingsState,
  lastOutcome,
  runningJob,
  transitionSettings,
  type Job,
  type Outcome,
  type SettingsEffect,
  type SettingsEvent,
} from "./settings-machine"

type Client = IpcClient<(typeof BrowserProfile)["spec"]>

/**
 * Settings › Browser: whether links open in the pane, the profile's sign-ins and the extensions it runs. Every action
 * goes through the settings machine, so one job runs at a time and each ends in a message.
 */
export default function BrowserSettings() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const desktop = ctx.desktop
  const preferences = ctx.stores.preferences
  const live = ctx.use(BrowserProfile)
  const [state, setState] = createSignal(initialSettingsState)
  const [version, setVersion] = createSignal(0)
  const [form, setForm] = createStore<{ source?: string; extensions?: string; store: string }>({ store: "" })
  // Each running job's call and timer, by attempt.
  const handles = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const client = () => {
    const current = live()

    return current.status === "active" ? current.value : undefined
  }

  // A new generation of main's Ipc, or a finished job, reads the profile again.
  const key = () => {
    const current = live()

    return current.status === "active" ? `${current.generation}:${version()}` : undefined
  }

  const dispatch = (event: SettingsEvent) => {
    const next = transitionSettings(untrack(state), event)
    setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SettingsEffect) => {
    if (effect.type === "refresh") return void setVersion((value) => value + 1)

    if (effect.type === "abort") {
      const handle = handles.get(effect.attempt)
      handles.delete(effect.attempt)
      clearTimeout(handle?.timer)
      handle?.controller.abort()

      return
    }

    const attempt = effect.attempt
    const current = client()

    if (!current) return dispatch({ type: "failed", attempt })
    const controller = new AbortController()
    handles.set(attempt, {
      controller,
      timer: setTimeout(() => dispatch({ type: "timed-out", attempt }), effect.timeoutMs),
    })
    void perform(current, effect.job, AbortSignal.any([ctx.signal, controller.signal])).then(
      (outcome) => dispatch({ type: "finished", attempt, outcome }),
      () => dispatch({ type: "failed", attempt }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const start = (job: Job) => dispatch({ type: "started", job })
  const busy = (type: Job["type"]) => runningJob(state())?.type === type
  const running = () => runningJob(state()) !== undefined

  const installing = (id: string) => {
    const job = runningJob(state())

    return job?.type === "install-browser" && job.id === id
  }

  const sources = createLatest(key, (_value, signal) => client()?.sources({ signal }) ?? Promise.resolve([]))
  const summary = createLatest(key, (_value, signal) => client()?.summary({ signal }) ?? Promise.resolve(undefined))
  const extensions = () => client()?.state()?.extensions ?? []

  const profiles = createMemo(() => profileOptions(sources.latest ?? []))
  const chromium = createMemo(() => profileOptions((sources.latest ?? []).filter((item) => item.engine === "chromium")))
  const selected = () => form.source ?? profiles()[0]?.value
  const selectedExtensions = () => form.extensions ?? chromium()[0]?.value

  const available = createLatest(
    () => {
      const current = key()
      const value = selectedExtensions()

      return current && value ? `${current}\n${value}` : undefined
    },
    (value, signal) => {
      const [, source = "", profile = ""] = value.split("\n")

      return client()?.browserExtensions({ source, profile }, { signal }) ?? Promise.resolve([])
    },
  )

  const message = createMemo(() => describe(lastOutcome(state())))

  function describe(outcome: Outcome | undefined) {
    if (!outcome || outcome.type === "changed") return undefined

    if (outcome.type === "error") return { text: ctx.t("common.requestFailed"), error: true }

    if (outcome.type === "cleared") return { text: ctx.t("settings.cleared"), error: false }

    if (outcome.type === "installed") {
      const result = outcome.result

      if (result.type === "installed")
        return { text: ctx.t("settings.extensions.done", { name: result.extension.name }), error: false }

      if (result.reason === "load")
        return { text: ctx.t("settings.extensions.failed.load", { message: result.message ?? "" }), error: true }

      return { text: ctx.t(`settings.extensions.failed.${result.reason}`), error: true }
    }

    const result = outcome.result

    if (result.type === "failed") return { text: ctx.t(`settings.import.failed.${result.reason}`), error: true }
    const done = ctx.plural("settings.import.done", result.imported)

    return {
      text: result.protected ? `${done} ${ctx.plural("settings.import.protected", result.protected)}` : done,
      error: result.imported === 0,
    }
  }

  const pickFile = async () => {
    const [file] =
      (await desktop?.pick({ title: ctx.t("settings.import.file.pick"), extensions: ["txt", "json"] })) ?? []

    if (file) start({ type: "import-file", path: file })
  }

  const pickFolder = async () => {
    const [folder] = (await desktop?.pick({ title: ctx.t("settings.extensions.folder.pick"), directory: true })) ?? []

    if (folder) start({ type: "install-folder", path: folder })
  }

  const importSelected = () => {
    const [source = "", profile = ""] = selected()?.split("\n") ?? []

    if (source) start({ type: "import-browser", source, profile })
  }

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
            onChange={(links) => preferences.set({ links })}
          />
        </ui.SettingsRow>
      </ui.SettingsSection>
      <ui.SettingsSection
        title={ctx.t("settings.signins.title")}
        footer={
          <Show when={message()}>
            {(current) => (
              <p
                role={current().error ? "alert" : "status"}
                classList={{ "text-text-danger-base": current().error, "text-v2-text-text-muted": !current().error }}
              >
                {current().text}
              </p>
            )}
          </Show>
        }
      >
        <ui.SettingsRow
          id="settings-browser-cookies"
          title={ctx.t("settings.cookies.title")}
          description={
            <Show when={summary.latest}>{(value) => ctx.plural("settings.cookies.count", value().cookies)}</Show>
          }
        >
          <ui.Button
            size="small"
            variant="danger"
            disabled={!client() || running() || !summary.latest?.cookies}
            busy={busy("clear")}
            onClick={() => start({ type: "clear" })}
          >
            {ctx.t("settings.cookies.clear")}
          </ui.Button>
        </ui.SettingsRow>
        <ui.SettingsRow
          id="settings-browser-import"
          title={ctx.t("settings.import.browser.title")}
          description={ctx.t("settings.import.browser.description")}
        >
          <div class="flex items-center gap-2">
            <ui.Select
              label={ctx.t("settings.import.browser.select")}
              options={profiles()}
              value={selected()}
              placeholder={ctx.t("settings.import.browser.none")}
              disabled={profiles().length === 0}
              onChange={(source) => setForm("source", source)}
            />
            <ui.Button
              size="small"
              disabled={!client() || !selected() || running()}
              busy={busy("import-browser")}
              onClick={importSelected}
            >
              {ctx.t("settings.import.action")}
            </ui.Button>
          </div>
        </ui.SettingsRow>
        <ui.SettingsRow
          id="settings-browser-import-file"
          title={ctx.t("settings.import.file.title")}
          description={ctx.t("settings.import.file.description")}
        >
          <ui.Button
            size="small"
            disabled={!client() || !desktop || running()}
            busy={busy("import-file")}
            onClick={() => void pickFile()}
          >
            {ctx.t("settings.import.file.action")}
          </ui.Button>
        </ui.SettingsRow>
      </ui.SettingsSection>
      <ui.SettingsSection title={ctx.t("settings.extensions.title")}>
        <ui.SettingsRow
          id="settings-browser-extensions"
          title={ctx.t("settings.extensions.title")}
          description={ctx.t("settings.extensions.description")}
        />
        <For each={extensions()} fallback={<ui.SettingsRow title={ctx.t("settings.extensions.empty")} />}>
          {(extension) => (
            <ExtensionRow
              extension={extension}
              disabled={!client() || running()}
              onEnable={(enabled) => start({ type: "enable", id: extension.id, enabled })}
              onRemove={() => start({ type: "remove", id: extension.id })}
            />
          )}
        </For>
        <ui.SettingsRow
          title={ctx.t("settings.extensions.store.title")}
          description={ctx.t("settings.extensions.store.description")}
        >
          <div class="flex items-center gap-2">
            <ui.TextInput
              label={ctx.t("settings.extensions.store.title")}
              placeholder={ctx.t("settings.extensions.store.placeholder")}
              type="url"
              value={form.store}
              onInput={(value) => setForm("store", value)}
              onSubmit={(url) => {
                if (url.trim() && !running()) start({ type: "install-store", url: url.trim() })
              }}
              class="w-64"
            />
            <ui.Button
              size="small"
              disabled={!client() || !form.store.trim() || running()}
              busy={busy("install-store")}
              onClick={() => start({ type: "install-store", url: form.store.trim() })}
            >
              {ctx.t("settings.extensions.add")}
            </ui.Button>
          </div>
        </ui.SettingsRow>
        <ui.SettingsRow
          title={ctx.t("settings.extensions.browser.title")}
          description={ctx.t("settings.extensions.browser.description")}
        >
          <ui.Select
            label={ctx.t("settings.import.browser.select")}
            options={chromium()}
            value={selectedExtensions()}
            placeholder={ctx.t("settings.import.browser.none")}
            disabled={chromium().length === 0}
            onChange={(value) => setForm("extensions", value)}
          />
        </ui.SettingsRow>
        <For each={available.latest ?? []}>
          {(item) => (
            <ui.SettingsRow title={<ExtensionTitle name={item.name} icon={item.icon} />} description={item.version}>
              <ui.Button
                size="small"
                disabled={!client() || item.installed || running()}
                busy={installing(item.id)}
                onClick={() => {
                  const [source = "", profile = ""] = selectedExtensions()?.split("\n") ?? []
                  start({ type: "install-browser", source, profile, id: item.id })
                }}
              >
                {item.installed ? ctx.t("settings.extensions.added") : ctx.t("settings.extensions.add")}
              </ui.Button>
            </ui.SettingsRow>
          )}
        </For>
        <ui.SettingsRow
          title={ctx.t("settings.extensions.folder.title")}
          description={ctx.t("settings.extensions.folder.description")}
        >
          <ui.Button
            size="small"
            disabled={!client() || !desktop || running()}
            busy={busy("install-folder")}
            onClick={() => void pickFolder()}
          >
            {ctx.t("settings.extensions.folder.action")}
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
      title={<ExtensionTitle name={props.extension.name} icon={props.extension.icon} />}
      description={
        <Show when={props.extension.error} fallback={props.extension.version}>
          {(error) => <span class="text-text-danger-base">{error()}</span>}
        </Show>
      }
    >
      <div class="flex items-center gap-1">
        <ui.Switch
          label={ctx.t("settings.extensions.enable", { name: props.extension.name })}
          hideLabel
          checked={props.extension.enabled}
          disabled={props.disabled}
          onChange={props.onEnable}
        />
        <ui.Tooltip value={ctx.t("settings.extensions.remove")}>
          <ui.IconButton
            icon="outline-trash"
            label={ctx.t("settings.extensions.remove")}
            disabled={props.disabled}
            onClick={props.onRemove}
          />
        </ui.Tooltip>
      </div>
    </ui.SettingsRow>
  )
}

function ExtensionTitle(props: { name: string; icon?: string }) {
  const ctx = usePlugin()

  return (
    <span class="flex min-w-0 items-center gap-2">
      <Show when={props.icon} fallback={<ctx.ui.Icon name="extensions" class="text-v2-icon-icon-muted" />}>
        {(icon) => <img src={icon()} alt="" class="size-4 shrink-0" />}
      </Show>
      <span class="min-w-0 truncate">{props.name}</span>
    </span>
  )
}

/** One choice per browser profile; the profile's name shows only for a browser with several. */
function profileOptions(sources: readonly ProfileSource[]) {
  return sources.flatMap((source) =>
    source.profiles.map((profile) => ({
      value: `${source.id}\n${profile.id}`,
      label: source.profiles.length > 1 ? `${source.name} · ${profile.name}` : source.name,
    })),
  )
}

/** Runs one job against main and says how it ended. */
async function perform(client: Client, job: Job, signal: AbortSignal): Promise<Outcome> {
  switch (job.type) {
    case "import-browser":
      return {
        type: "imported",
        result: await client.importBrowser({ source: job.source, profile: job.profile }, { signal }),
      }
    case "import-file":
      return { type: "imported", result: await client.importFile({ path: job.path }, { signal }) }
    case "install-store":
      return { type: "installed", result: await client.install({ kind: "store", url: job.url }, { signal }) }
    case "install-folder":
      return { type: "installed", result: await client.install({ kind: "folder", path: job.path }, { signal }) }
    case "install-browser":
      return {
        type: "installed",
        result: await client.install(
          { kind: "browser", source: job.source, profile: job.profile, id: job.id },
          { signal },
        ),
      }
    case "remove":
      await client.remove({ id: job.id }, { signal })

      return { type: "changed" }
    case "enable":
      await client.enable({ id: job.id, enabled: job.enabled }, { signal })

      return { type: "changed" }
    case "clear":
      await client.clear({ signal })

      return { type: "cleared" }
  }
}
