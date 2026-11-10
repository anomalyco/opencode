import { createSignal, onCleanup, untrack } from "solid-js"
import { createLatest, usePlugin, type IpcClient } from "@opencode/plugin/gui"
import type definition from "./index"
import { BrowserProfile, type ProfileSource } from "./profile/ipc"
import {
  importedCookies,
  initialJobsState,
  lastFinished,
  runningJob,
  transitionJobs,
  type Finished,
  type Job,
  type JobsEffect,
  type JobsEvent,
  type Outcome,
} from "./jobs-machine"

type Client = IpcClient<(typeof BrowserProfile)["spec"]>

export type ProfileJobs = ReturnType<typeof createProfileJobs>

/** What a surface says about a finished job, and whether it is bad news. */
export type JobMessage = { readonly text: string; readonly error: boolean }

/**
 * The browser profile as one surface drives it: the settings page, or the pane's import prompt. It runs the jobs
 * machine against main's Ipc, one job at a time, and reads the profile again after each. Call it in a component.
 *
 * `finished` runs once per job, when it ends, for what the surface does next, such as reloading the page.
 */
export function createProfileJobs(input: { readonly finished?: (finished: Finished) => void } = {}) {
  const ctx = usePlugin<typeof definition>()
  const live = ctx.use(BrowserProfile)
  const preferences = ctx.stores.preferences
  const [state, setState] = createSignal(initialJobsState)
  const [version, setVersion] = createSignal(0)
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

  const dispatch = (event: JobsEvent) => {
    const next = transitionJobs(untrack(state), event)
    setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: JobsEffect) => {
    if (effect.type === "notify") {
      setVersion((value) => value + 1)
      input.finished?.(effect.finished)

      // Cookies came in: the user is signed in, so the pane stops offering the import. Last, as it may unmount the
      // surface that runs this.
      if (importedCookies(effect.finished.outcome) > 0 && !preferences.value.welcomed)
        preferences.set({ ...preferences.value, welcomed: true })

      return
    }

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

  const sources = createLatest(key, (_value, signal) => client()?.sources({ signal }) ?? Promise.resolve([]))
  const summary = createLatest(key, (_value, signal) => client()?.summary({ signal }) ?? Promise.resolve(undefined))

  const browserName = (job: Job) =>
    job.type === "import-browser" ? sources.latest?.find((source) => source.id === job.source)?.name : undefined

  /** What to say about a finished job; undefined for one whose result the surface already shows. */
  const describe = (finished: Finished | undefined): JobMessage | undefined => {
    if (!finished || finished.outcome.type === "changed") return undefined
    const outcome = finished.outcome

    if (outcome.type === "error") return { text: ctx.t("common.requestFailed"), error: true }

    if (outcome.type === "cleared") return { text: ctx.t("settings.cleared"), error: false }

    if (outcome.type === "installed") {
      const result = outcome.result

      if (result.type === "installed")
        return { text: ctx.t("extensions.added", { name: result.extension.name }), error: false }

      if (result.reason === "load")
        return { text: ctx.t("extensions.failed.load", { message: result.message ?? "" }), error: true }

      return { text: ctx.t(`extensions.failed.${result.reason}`), error: true }
    }

    const result = outcome.result
    // Names the browser where the user has to act on it, such as quitting it.
    const browser = browserName(finished.job)

    if (result.type === "failed" && result.reason === "locked" && browser)
      return { text: ctx.t("signins.failed.locked.named", { browser }), error: true }

    if (result.type === "failed") return { text: ctx.t(`signins.failed.${result.reason}`), error: true }

    if (result.imported === 0 && result.protected > 0)
      return {
        text: browser ? ctx.t("signins.protected.named", { browser }) : ctx.t("signins.protected"),
        error: true,
      }

    return { text: ctx.plural("signins.imported", result.imported), error: result.imported === 0 }
  }

  return {
    /** Main's profile answers; false on the web and while its plugin is away. */
    available: () => !!client(),
    /** Changes when the profile should be read again: after a job, or when main's Ipc restarts. */
    key,
    start: (job: Job) => dispatch({ type: "started", job }),
    dismiss: () => dispatch({ type: "dismissed" }),
    running: () => runningJob(state()),
    last: () => lastFinished(state()),
    describe,
    /** Browsers to import from, the one used last first. Empty until main answers. */
    sources: (): readonly ProfileSource[] => sources.latest ?? [],
    /** Whether main has answered with the browsers once, so an empty list means none are installed. */
    sourcesLoaded: () => sources.latest !== undefined,
    summary: () => summary.latest,
    extensions: () => client()?.state()?.extensions ?? [],
    /** The extensions one Chromium profile has installed. */
    browserExtensions: (source: string, profile: string, signal: AbortSignal) =>
      client()?.browserExtensions({ source, profile }, { signal }) ?? Promise.resolve([]),
  }
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
