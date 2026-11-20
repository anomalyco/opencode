import { createSignal, onCleanup, untrack } from "solid-js"
import { createKeyed, createLatest, usePlugin, type IpcClient } from "@opencode/plugin/gui"
import type { Choice } from "./choices"
import type definition from "./index"
import { BrowserProfile, type ExtensionCompatibility, type ImportResult, type ProfileSource } from "./profile/ipc"
import {
  importedCookies,
  importLoss,
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

/** One surface's jobs, as `createProfileJobs` returns them; a dialog the surface opens may run its jobs there. */
export type ProfileJobs = ReturnType<typeof createProfileJobs>

/**
 * What a surface says about a finished job, and whether it is bad news. An install that added an extension which only
 * partly works here, or added nothing because it will not work here, says what will not work.
 */
export type JobMessage = {
  readonly text: string
  readonly error: boolean
  readonly compatibility?: ExtensionCompatibility
}

/**
 * The browser profile as one surface drives it: the settings page, or the pane's import prompt. It runs the jobs
 * machine against main's Ipc, one job at a time, and reads the profile again after each. Call it in a component.
 *
 * `finished` runs once per job, when it ends, for what the surface does next, such as reloading the page. `cookies`
 * reads the summary again whenever the profile's cookies change, for a surface that shows the count. With `profile`
 * false it reads neither the browsers nor the summary, for a surface that shows neither.
 */
export function createProfileJobs(
  input: {
    readonly finished?: (finished: Finished) => void
    readonly cookies?: boolean
    readonly profile?: boolean
  } = {},
) {
  const ctx = usePlugin<typeof definition>()
  const live = ctx.use(BrowserProfile)
  const preferences = ctx.stores.preferences
  const [state, setState] = createSignal(initialJobsState)
  const [version, setVersion] = createSignal(0)
  const mac = ctx.desktop?.os === "macos"
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

      // Signing out everywhere forgets where the person has been: main's history went with the cookies, and the
      // window's list of the last pages goes here.
      if (effect.finished.outcome.type === "cleared") ctx.stores.history.set({ visits: [] })

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

  // The installed browsers change only with a new generation of main's Ipc, not with a job.
  const sources = createLatest(
    () => {
      const current = live()

      return input.profile !== false && current.status === "active" ? current.generation : undefined
    },
    (_value, signal) => client()?.sources({ signal }) ?? Promise.resolve([]),
  )

  const [cookies, setCookies] = createSignal(0)

  // Main says when browsing changed the cookies; the SDK removes the listener when the Ipc's generation ends.
  if (input.cookies) createKeyed(client, (current) => current.on("cookies", () => setCookies((value) => value + 1)))

  const summary = createLatest(
    () => {
      const current = key()

      return current === undefined || input.profile === false ? undefined : `${current}:${cookies()}`
    },
    (_value, signal) => client()?.summary({ signal }) ?? Promise.resolve(undefined),
  )

  const source = (job: Job) =>
    job.type === "import-browser" ? sources.latest?.find((item) => item.id === job.source) : undefined

  const browserName = (job: Job) => source(job)?.name
  // On macOS a Chromium browser's cookie key is in the login Keychain, and the system asks before handing it over.
  const keychain = (job: Job) => mac && source(job)?.engine === "chromium"

  /**
   * The one line for an import that lost nothing. An import from a browser says what came, in words: sign-ins,
   * history, both, or nothing. A cookie file names no browser and brings only cookies, which it counts.
   */
  const imported = (result: Extract<ImportResult, { type: "imported" }>, browser?: string) => {
    if (!browser) return ctx.plural("signins.imported", result.imported)

    if (result.imported > 0) return ctx.t(result.pages ? "signins.imported.history.from" : "signins.imported.from", { browser })

    return ctx.t(result.pages ? "signins.imported.history.only.from" : "signins.imported.none.from", { browser })
  }

  /** What to say about a finished job; undefined for one whose result the surface already shows. */
  const describe = (finished: Finished | undefined): JobMessage | undefined => {
    if (!finished || finished.outcome.type === "changed") return undefined
    const outcome = finished.outcome

    // Main did not answer: say what the person tried, by the job.
    if (outcome.type === "error") {
      const type = finished.job.type

      if (type === "clear") return { text: ctx.t("settings.failed.clear"), error: true }

      if (type === "enable" || type === "remove") return { text: ctx.t("settings.failed.extension"), error: true }

      return { text: ctx.t(type === "import-browser" || type === "import-file" ? "settings.failed.import" : "settings.failed.install"), error: true }
    }

    // The sign-out worked; history that stayed behind is said, or "everywhere" would be a false claim.
    if (outcome.type === "cleared")
      return outcome.history ? { text: ctx.t("settings.cleared"), error: false } : { text: ctx.t("settings.cleared.history"), error: true }

    if (outcome.type === "installed") {
      const result = outcome.result

      if (result.type === "installed" && result.extension.compatibility.level !== "supported")
        return {
          text: ctx.t(`extensions.added.${result.extension.compatibility.level}`, { name: result.extension.name }),
          error: false,
          compatibility: result.extension.compatibility,
        }

      if (result.type === "installed")
        return { text: ctx.t("extensions.added", { name: result.extension.name }), error: false }

      if (result.type === "review") return { text: ctx.t("extensions.review", { name: result.name }), error: false }

      if (result.type !== "failed")
        return {
          text: ctx.t("extensions.unsupported", { name: result.name }),
          error: true,
          compatibility: result.compatibility,
        }

      if (result.reason === "load")
        return { text: ctx.t("extensions.failed.load", { message: result.message ?? "" }), error: true }

      return { text: ctx.t(`extensions.failed.${result.reason}`), error: true }
    }

    const result = outcome.result
    // Names the browser where the user has to act on it, such as quitting it.
    const browser = browserName(finished.job)

    if (result.type === "failed" && result.reason === "locked" && browser)
      return { text: ctx.t("signins.failed.locked.named", { browser }), error: true }

    if (result.type === "failed" && result.reason === "key" && browser && keychain(finished.job))
      return { text: ctx.t("signins.failed.keychain", { browser }), error: true }

    // A cookie file that cannot be read is no browser's data, and there is no browser to close.
    if (result.type === "failed" && result.reason === "read" && finished.job.type === "import-file")
      return { text: ctx.t("signins.failed.read.file"), error: true }

    if (result.type === "failed") return { text: ctx.t(`signins.failed.${result.reason}`), error: true }

    const loss = importLoss(result)

    // A cookie file is cookies and says so in counts: how many came, and how many did not. A browser's import never
    // counts cookies.
    if (loss?.reason === "other" && finished.job.type === "import-file")
      return { text: ctx.plural("signins.imported.incomplete", result.imported, { omitted: loss.count }), error: result.imported === 0 }

    if (result.imported === 0 && loss?.reason === "protected")
      return {
        text: browser ? ctx.t("signins.protected.named", { browser }) : ctx.t("signins.protected"),
        error: true,
      }

    // No sign-in could be brought and no history came with them: nothing was imported.
    if (result.imported === 0 && loss && !result.pages)
      return { text: browser ? ctx.t("signins.imported.none.from", { browser }) : ctx.t("settings.failed.import"), error: true }

    // Some sign-ins stayed behind, as Chrome's and Edge's app-bound ones on Windows do: their sites open signed out.
    if (loss)
      return {
        text: browser ? ctx.t("signins.imported.partial.named", { browser }) : ctx.t("signins.imported.partial"),
        error: false,
      }

    return { text: imported(result, browser), error: result.imported === 0 && !result.pages }
  }

  return {
    /** Main's profile answers; false on the web and while its plugin is away. */
    available: () => !!client(),
    /** Changes when the profile should be read again: after a job, or when main's Ipc restarts. */
    key,
    start: (job: Job) => dispatch({ type: "started", job }),
    dismiss: () => dispatch({ type: "dismissed" }),
    running: () => runningJob(state()),
    /** Whether the running job imports from this browser profile. */
    importing: (choice: Choice) => {
      const job = runningJob(state())

      return job?.type === "import-browser" && job.source === choice.source.id && job.profile === choice.profile.id
    },
    last: () => lastFinished(state()),
    describe,
    /** The one line that says what a browser's import brought: "Imported sign-ins and history from Helium". */
    imported,
    /** What to say while a job runs: on macOS, what the Keychain prompt in front of the window asks, and how to answer. */
    notice: (): JobMessage | undefined => {
      const job = runningJob(state())
      const browser = job && keychain(job) ? browserName(job) : undefined

      return browser ? { text: ctx.t("signins.keychain", { browser }), error: false } : undefined
    },
    /** Why sign-ins cannot be saved here, so the surface offers no import; undefined while they can or until main answers. */
    unsaved: (): JobMessage | undefined =>
      summary.latest?.persistent === false
        ? { text: ctx.t(mac ? "signins.unsaved.mac" : "signins.unsaved"), error: true }
        : undefined,
    /** Browsers to import from, the one used last first. Empty until main answers. */
    sources: (): readonly ProfileSource[] => sources.latest ?? [],
    /** Whether main has answered with the browsers once, so an empty list means none are installed. */
    sourcesLoaded: () => sources.latest !== undefined,
    summary: () => summary.latest,
    extensions: () => client()?.state()?.extensions ?? [],
    /** Whether remote servers share the profile's sign-ins; undefined until main's profile answers. */
    remoteSignIns: () => client()?.state()?.remoteSignIns,
    /** The switch shows main's state, so a call that fails leaves it where it was. */
    shareSignIns: (enabled: boolean) => void client()?.shareSignIns({ enabled }, { signal: ctx.signal }).catch(() => undefined),
    /** The sites one browser profile has cookies for, without any cookie's name or value. Rejects while main is away. */
    sites: (source: string, profile: string, signal: AbortSignal) =>
      client()?.sites({ source, profile }, { signal }) ?? Promise.reject(new Error("browser.profile.unavailable")),
    /** The extensions one Chromium profile has installed. */
    browserExtensions: (source: string, profile: string, signal: AbortSignal) =>
      client()?.browserExtensions({ source, profile }, { signal }) ?? Promise.resolve([]),
  }
}

/** Runs one job against main and says how it ended. */
async function perform(client: Client, job: Job, signal: AbortSignal): Promise<Outcome> {
  if ("token" in job && job.token) return { type: "installed", result: await client.install({ kind: "approve", token: job.token }, { signal }) }

  switch (job.type) {
    case "import-browser":
      return {
        type: "imported",
        result: await client.importBrowser(
          { source: job.source, profile: job.profile, sites: job.sites, cookies: job.signins !== false, history: job.history !== false },
          { signal },
        ),
      }
    case "import-file":
      return { type: "imported", result: await client.importFile({ path: job.path }, { signal }) }
    case "install-store":
      return {
        type: "installed",
        result: await client.install({ kind: "store", url: job.url }, { signal }),
      }
    case "install-folder":
      return {
        type: "installed",
        result: await client.install({ kind: "folder", path: job.path }, { signal }),
      }
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
      return { type: "cleared", history: (await client.clear({ signal })).history }
  }
}
