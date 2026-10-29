#!/usr/bin/env bun
// Records a new user's first launch of a packaged OpenCode Desktop build and checks the onboarding invariants in
// ./invariants.ts as it goes: the splash, the new session page with a focused composer, and a first prompt that gets
// a reply from a free model without signing in.
//
//   bun run onboarding:video                                                  the build from 'bun run build && bun run pack'
//   bun run onboarding:video -- --app "dist/desktop/app/OpenCode Dev.exe"    any packaged build (.exe, .app or binary)
//   bun run onboarding:video -- --installer <file | url> --disposable        Windows: run the real installer first
//
//   --out <dir>        where the videos and report go (default: dist/onboarding/<time> at the repository root)
//   --prompt <text>    the first message to send
//   --theme <name>     dark (default), light, or system
//   --label <text>     names the build in the video and report (default: the app's name and version)
//   --keep-sandbox     keep the throwaway profile for inspection
//   --disposable       confirms --installer may install into this machine's user profile
//
// The app runs against a throwaway profile, service, Documents folder and home directory with no credentials, so a
// recording never reads or changes the developer's own OpenCode. The output directory gets index.html (the video
// against the invariants), onboarding.mp4, onboarding-annotated.mp4, report.json and, on failure, failure.png.
// The last line printed is the path of report.json. Exit code 0 when every invariant held, 1 when one failed, 2 when
// the recorder itself could not run.
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { Schema } from "effect"
import { connect, evaluate, params, type Cdp, type CdpEvent } from "./cdp"
import { INVARIANTS, type InvariantID, type Outcome } from "./invariants"
import { PROBE, SNAPSHOT, Snapshot } from "./probe"
import { summary, writeReport, type Report } from "./report"
import { createSandbox, killTree, launch, protocolGuard, sandboxLogs, stopSandboxServices } from "./sandbox"
import { annotate, concat, encode, ffmpegAvailable, still, type Caption, type Frame } from "./video"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    app: { type: "string" },
    installer: { type: "string" },
    out: { type: "string" },
    prompt: { type: "string", default: "Reply with one short, friendly sentence welcoming me to OpenCode." },
    theme: { type: "string", default: "dark" },
    label: { type: "string" },
    "keep-sandbox": { type: "boolean", default: false },
    disposable: { type: "boolean", default: false },
  },
})

const repository = resolve(import.meta.dirname, "..", "..", "..", "..")

const out = resolve(
  args.values.out ?? join(repository, "dist", "onboarding", new Date().toISOString().replace(/[:.]/g, "-")),
)

const scratch = join(tmpdir(), `opencode-onboarding-video-${process.pid}`)

const frameDir = join(scratch, "frames")

const startedAt = new Date().toISOString()

type Page = { session?: string; crashed: boolean; label?: string }

type Connections = { browser?: Cdp; main?: Awaited<ReturnType<typeof holdReady>> }

const Attached = Schema.Struct({
  sessionId: Schema.String,
  targetInfo: Schema.Struct({ type: Schema.String }),
  waitingForDebugger: Schema.Boolean,
})

const ScreencastFrame = Schema.Struct({
  data: Schema.String,
  sessionId: Schema.Number,
  metadata: Schema.Struct({ timestamp: Schema.optional(Schema.Number) }),
})

const Exception = Schema.Struct({
  exceptionDetails: Schema.Struct({
    text: Schema.optional(Schema.String),
    exception: Schema.optional(Schema.Struct({ description: Schema.optional(Schema.String) })),
  }),
})

const ConsoleCall = Schema.Struct({
  type: Schema.String,
  args: Schema.Array(
    Schema.Struct({ value: Schema.optional(Schema.Json), description: Schema.optional(Schema.String) }),
  ),
})

async function main() {
  const installed = args.values.installer ? await install(args.values.installer) : undefined
  const app = installed?.exe ?? resolve(args.values.app ?? defaultApp())

  if (!existsSync(app)) throw new Error(`No packaged app at ${app}. Run 'bun run build && bun run pack' or pass --app.`)

  const sandbox = await createSandbox(join(scratch, "sandbox"))
  const restoreProtocol = protocolGuard(scratch)
  console.log(`recording ${app}\nprofile   ${sandbox.root}\noutput    ${out}`)

  const run = await record(app, sandbox.env).finally(() => {
    const stopped = stopSandboxServices(sandbox.root)

    if (stopped.length) console.log(`stopped ${stopped.length} sandbox service(s)`)
  })

  const protocol = restoreProtocol()
  const logs = copyLogs(sandbox.root)

  const documents = existsSync(sandbox.root)
    ? readdirSync(sandbox.root, { recursive: true, withFileTypes: true }).some(
        (entry) => entry.isDirectory() && basename(entry.parentPath) === "documents",
      )
    : false

  if (args.values["keep-sandbox"]) cpSync(sandbox.root, join(out, "sandbox"), { recursive: true })

  const label = args.values.label ?? run.label ?? basename(app)
  const passed = INVARIANTS.every((invariant) => run.outcomes.get(invariant.id)?.status === "passed")

  const outcomes = INVARIANTS.map(
    (invariant): Outcome => run.outcomes.get(invariant.id) ?? { id: invariant.id, status: "skipped" },
  )

  const videos = renderVideos(run, label, outcomes, installed?.video)

  const facts: Report["facts"] = { "bundled CLI": bundledCli(app), ...run.facts }

  if (installed) {
    facts["installer ms"] = installed.ms
    facts["installed to"] = dirname(installed.exe)
  }

  const report: Report = {
    passed,
    build: { app, label, platform: `${process.platform} ${process.arch}`, installer: args.values.installer },
    startedAt,
    videoStart: run.frames[0]?.at,
    launchedAt: run.launchedAt,
    outcomes,
    facts: {
      ...facts,
      "opencode:// handler": protocol,
      "default project in the sandbox": documents,
      theme: args.values.theme,
      prompt: args.values.prompt,
    },
    errors: run.errors,
    videos,
    logs,
  }

  writeReport(out, report)
  console.log(`\n${summary(report)}\n\nreport: ${join(out, "index.html")}\n${join(out, "report.json")}`)

  return passed ? 0 : 1
}

async function record(app: string, env: Record<string, string>) {
  const outcomes = new Map<InvariantID, Outcome>()
  const frames: Frame[] = []
  const errors: string[] = []
  const facts: Report["facts"] = {}
  const anchors: Partial<Record<InvariantID | "launch" | "enter", number>> = {}
  const node = Promise.withResolvers<string>()
  const devtools = Promise.withResolvers<string>()
  const page: Page = { crashed: false }
  const launchedAt = Date.now()
  anchors.launch = launchedAt

  // --inspect-brk lets the recorder hold Electron's ready event until it is attached, so the window's first frame is
  // recorded. Builds that refuse it still record, from the moment the recorder attaches.
  const child = launch(
    executable(app),
    [
      "--inspect-brk=0",
      "--remote-debugging-port=0",
      "--lang=en-US",
      // A window behind other windows keeps painting, so the video never freezes.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
    env,
    (line) => {
      const inspector = line.match(/Debugger listening on (ws:\/\/\S+)/)?.[1]
      const browser = line.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]

      if (inspector) node.resolve(inspector)

      if (browser) devtools.resolve(browser)
    },
  )

  const exited = new Promise<number | null>((done) => child.once("exit", done))
  let gone = false
  void exited.then(() => (gone = true))
  const connections: Connections = {}

  try {
    connections.main = await holdReady(node.promise)
    connections.browser = await connect(
      await within(devtools.promise, 60_000, "The app never opened a DevTools endpoint"),
    )
    const browser = connections.browser
    browser.on((event) => void onEvent(browser, event).catch(() => {}))
    await browser.send("Target.setDiscoverTargets", { discover: true })
    await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
    facts["capture held at ready"] = !!connections.main
    await connections.main?.release()
    page.label = await connections.main?.label().catch(() => undefined)
    await check(browser)
    await settle(browser)
  } finally {
    await connections.browser?.send("Page.stopScreencast", {}, page.session).catch(() => {})
    connections.browser?.close()
    connections.main?.close()

    if (child.pid) killTree(child.pid)
    await Promise.race([exited, sleep(5000)])
  }

  return { outcomes, frames, errors, facts, launchedAt, label: page.label, end: Date.now() }

  async function snapshot(browser: Cdp) {
    if (!page.session || gone || page.crashed) return undefined

    return evaluate(browser, SNAPSHOT, Snapshot, { sessionId: page.session }).catch(() => undefined)
  }

  async function onEvent(cdp: Cdp, event: CdpEvent) {
    const attached = event.method === "Target.attachedToTarget" ? params(Attached, event) : undefined

    if (attached) {
      const session = attached.sessionId

      if (attached.targetInfo.type !== "page" || page.session) {
        if (attached.waitingForDebugger) await cdp.send("Runtime.runIfWaitingForDebugger", {}, session)

        return
      }

      page.session = session
      // Sent together: the session applies them in order, and some only answer once the paused renderer runs.
      await Promise.allSettled([
        cdp.send("Page.enable", {}, session),
        cdp.send("Runtime.enable", {}, session),
        cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE }, session),
        // The app draws the splash and the session the way most users see them, whatever this machine prefers.
        cdp.send("Emulation.setEmulatedMedia", { features: media() }, session),
        // A window behind other windows still behaves as the focused window a user just opened.
        cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, session),
        cdp.send(
          "Page.startScreencast",
          { format: "jpeg", quality: 92, everyNthFrame: 1, maxWidth: 3840, maxHeight: 2400 },
          session,
        ),
        attached.waitingForDebugger
          ? cdp.send("Runtime.runIfWaitingForDebugger", {}, session)
          : evaluate(cdp, PROBE, Schema.Unknown, { sessionId: session }).catch(() => {}),
      ])

      const agent = await evaluate(cdp, "navigator.userAgent", Schema.String, { sessionId: session }).catch(() => "")
      facts.electron = agent.match(/Electron\/(\S+)/)?.[1]
      facts["device pixel ratio"] = await evaluate(cdp, "devicePixelRatio", Schema.Number, {
        sessionId: session,
      }).catch(() => undefined)

      return
    }

    if (event.sessionId !== page.session) return

    const frame = event.method === "Page.screencastFrame" ? params(ScreencastFrame, event) : undefined

    if (frame) {
      const file = join(frameDir, `frame-${String(frames.length).padStart(6, "0")}.jpg`)
      writeFileSync(file, Buffer.from(frame.data, "base64"))
      frames.push({ file, at: frame.metadata.timestamp ? Math.round(frame.metadata.timestamp * 1000) : Date.now() })
      await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }, page.session)

      return
    }

    if (event.method === "Inspector.targetCrashed") page.crashed = true

    const exception = event.method === "Runtime.exceptionThrown" ? params(Exception, event) : undefined

    if (exception) {
      const details = exception.exceptionDetails
      errors.push((details.exception?.description ?? details.text ?? "exception").split("\n")[0])
    }

    const logged = event.method === "Runtime.consoleAPICalled" ? params(ConsoleCall, event) : undefined

    if (logged?.type === "error")
      errors.push(
        logged.args
          .map((value) => value.description ?? JSON.stringify(value.value ?? ""))
          .join(" ")
          .slice(0, 300),
      )
  }

  async function check(browser: Cdp) {
    for (const invariant of INVARIANTS) {
      if (invariant.id === "prompt-sent") anchors.enter = await type(browser, args.values.prompt)
      const anchor = anchors[invariant.from] ?? Date.now()
      const deadline = anchor + invariant.budgetMs

      while (true) {
        const state = await snapshot(browser)
        const verdict = judge(invariant.id, state)

        if (verdict && "pass" in verdict) {
          outcomes.set(invariant.id, {
            id: invariant.id,
            status: "passed",
            at: verdict.pass - launchedAt,
            detail: verdict.detail,
          })
          anchors[invariant.id] = verdict.pass
          break
        }

        const failure =
          verdict?.fail ??
          (page.crashed ? "The window crashed." : undefined) ??
          (gone ? "The app exited." : undefined) ??
          (Date.now() > deadline
            ? `Did not happen within ${invariant.budgetMs / 1000}s. ${stateHint(state)}`
            : undefined)

        if (failure) {
          outcomes.set(invariant.id, {
            id: invariant.id,
            status: "failed",
            at: Date.now() - launchedAt,
            detail: failure,
          })
          console.log(`FAIL  ${invariant.title}: ${failure}`)

          return
        }

        await sleep(100)
      }

      console.log(`pass  ${invariant.title} (+${((anchors[invariant.id]! - launchedAt) / 1000).toFixed(1)}s)`)
    }
  }

  function judge(
    id: InvariantID,
    state: Snapshot | undefined,
  ): { pass: number; detail?: string } | { fail: string } | undefined {
    const seen = state?.seen ?? {}

    if (id === "window") return frames[0] ? { pass: frames[0].at } : undefined

    if (!state) return undefined

    if (seen.error) return { fail: `The session showed an error: ${state.error}` }

    if (id === "splash") {
      if (seen.plainSplash && !seen.splash)
        return { fail: "The plain loading splash showed: the app did not treat this as a first launch." }

      if (seen.splash && seen.drawStart) return { pass: Math.max(seen.splash, seen.drawStart) }

      if (seen.newSession || seen.home)
        return {
          fail: seen.splash
            ? "The splash showed but the wordmark never started drawing."
            : `The app showed without the first-launch splash${state.early === false ? " (the recorder attached after the page loaded)" : ""}.`,
        }

      return undefined
    }

    if (id === "new-session") {
      if (seen.home && (!seen.newSession || seen.home <= seen.newSession))
        return { fail: "The splash handed off to Home instead of the new session page." }

      const handoff = seen.handoff ?? seen.overlayGone

      if (seen.newSession && handoff) return { pass: Math.max(seen.newSession, handoff) }

      return undefined
    }

    if (id === "composer-focus")
      return seen.composerFocus ? { pass: Math.max(seen.composerFocus, anchors["new-session"] ?? 0) } : undefined

    if (id === "free-model") {
      facts.model = state.model

      return state.model && !/select model|unavailable/i.test(state.model)
        ? { pass: Date.now(), detail: state.model }
        : undefined
    }

    const enter = anchors.enter ?? Infinity

    if (id === "prompt-sent")
      return seen.userMessage && seen.userMessage >= enter && !state.editorText.trim()
        ? { pass: seen.userMessage }
        : undefined

    if (id === "working") return seen.working && seen.working >= enter ? { pass: seen.working } : undefined

    if (id === "reply") return seen.reply && seen.reply >= enter ? { pass: seen.reply } : undefined

    return undefined
  }

  // Types the prompt the way a person does, into whatever has focus (no click), then presses Enter.
  async function type(browser: Cdp, text: string) {
    const session = page.session
    await sleep(1200)

    for (const char of text) {
      await browser.send(
        "Input.dispatchKeyEvent",
        { type: "keyDown", key: char, text: char, unmodifiedText: char },
        session,
      )
      await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: char }, session)
      await sleep(45)
    }

    await sleep(600)
    const enter = Date.now()
    const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r", unmodifiedText: "\r" }, session)
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", ...key }, session)

    return enter
  }

  // Lets the reply finish, or the failure stay on screen, before the video ends.
  async function settle(browser: Cdp) {
    const failed = [...outcomes.values()].some((outcome) => outcome.status === "failed")
    const deadline = Date.now() + (failed ? 3000 : 120_000)
    let last = ""
    let stable = Date.now()

    while (Date.now() < deadline && !gone) {
      const state = await snapshot(browser)

      if (state) {
        facts.reply = state.reply || facts.reply
        facts["splash drawn at hand-off"] =
          state.facts.drawnAtHandoff === undefined || state.facts.drawnAtHandoff === null
            ? undefined
            : `${Math.round(state.facts.drawnAtHandoff * 100)}%`
        facts["probe installed before the page loaded"] = state.early
        facts["view at hand-off"] = state.facts.viewAtHandoff

        if (state.reply !== last) {
          last = state.reply
          stable = Date.now()
        }

        if (!failed && !state.working && state.reply && Date.now() - stable > 2500) break
      }

      await sleep(200)
    }

    const reply = outcomes.get("reply")

    if (reply?.status === "passed") facts["reply finished ms"] = stable - launchedAt
    await sleep(failed ? 0 : 1500)
  }
}

function stateHint(state: Snapshot | undefined) {
  if (!state) return "The window never answered."
  const seen = Object.keys(state.seen).join(", ") || "nothing yet"

  return `Seen: ${seen}. Model: ${state.model || "none"}.`
}

// Holds Electron's ready event until the recorder is attached to the browser, so the window's first frame and the
// splash are recorded. Playwright's Electron launcher does the same.
async function holdReady(url: Promise<string>) {
  const target = await Promise.race([url, sleep(15_000).then(() => undefined)])

  if (!target) return undefined
  const cdp = await connect(target)
  const paused = () => nextEvent(cdp, "Debugger.paused", 15_000)

  const hook = () => evaluate(cdp, HOLD, Schema.Boolean, { commandLine: true, paused: true })

  const install = async () => {
    await cdp.send("Runtime.enable")
    await cdp.send("Debugger.enable")
    const first = paused()
    await cdp.send("Runtime.runIfWaitingForDebugger")
    await first

    if (await hook().catch(() => false)) return true

    // The first pause can come before Electron's own modules load; the app's entry is late enough.
    await cdp.send("Debugger.setBreakpointByUrl", {
      urlRegex: "[\\\\/]out[\\\\/]main[\\\\/]index\\.js$",
      lineNumber: 0,
    })

    const next = paused()
    await cdp.send("Debugger.resume")

    return next.then(hook).catch(() => false)
  }

  const held = await install().catch(() => false)
  // Disabling the debugger also resumes the app and drops the breakpoint, whatever happened above.
  await cdp.send("Debugger.disable").catch(() => {})

  if (!held) {
    cdp.close()

    return undefined
  }

  return {
    release: () => evaluate(cdp, "globalThis.__onboardingRelease()", Schema.Unknown),
    label: () =>
      evaluate(
        cdp,
        `(() => { const { app } = require("electron"); return app.getName() + " " + app.getVersion() })()`,
        Schema.String,
        { commandLine: true },
      ),
    close: () => cdp.close(),
  }
}

const HOLD = `(() => {
  const { app } = require("electron")
  if (!app || typeof app.whenReady !== "function") return false
  const ready = app.whenReady()
  const { emit, isReady, whenReady } = app
  const released = Promise.withResolvers()
  let pending
  app.emit = function (event, ...rest) {
    if (event !== "ready") return emit.call(this, event, ...rest)
    pending = rest
    return this.listenerCount("ready") > 0
  }
  app.isReady = () => false
  app.whenReady = () => released.promise
  globalThis.__onboardingRelease = async () => {
    await ready
    Object.assign(app, { emit, isReady, whenReady })
    released.resolve()
    emit.call(app, "ready", ...(pending ?? []))
  }
  return true
})()`

function nextEvent(cdp: Cdp, method: string, timeout: number) {
  return new Promise<CdpEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`Timed out waiting for ${method}`))
    }, timeout)

    const stop = cdp.on((event) => {
      if (event.method !== method) return
      clearTimeout(timer)
      stop()
      resolve(event)
    })
  })
}

function media() {
  const theme = args.values.theme

  return [
    { name: "prefers-reduced-motion", value: "no-preference" },
    ...(theme === "dark" || theme === "light" ? [{ name: "prefers-color-scheme", value: theme }] : []),
  ]
}

function renderVideos(
  run: Awaited<ReturnType<typeof record>>,
  label: string,
  outcomes: Outcome[],
  installerVideo?: string,
) {
  if (!run.frames.length || !ffmpegAvailable()) {
    if (run.frames.length) console.warn("ffmpeg is not on PATH: no video was written")

    return {}
  }

  const clean = join(out, "onboarding.mp4")
  const size = encode(run.frames, frameDir, clean, run.end)
  const failed = outcomes.some((outcome) => outcome.status === "failed")

  const captions: Caption[] = INVARIANTS.map((invariant) => {
    const outcome = outcomes.find((item) => item.id === invariant.id)

    return {
      label: CAPTIONS[invariant.id],
      time: outcome?.at === undefined ? undefined : `${(outcome.at / 1000).toFixed(1)}s`,
      at: outcome?.at === undefined ? undefined : run.launchedAt + outcome.at,
      status: outcome?.status ?? "skipped",
    }
  })

  const annotated = join(out, "onboarding-annotated.mp4")
  const title = `${label} · ${process.platform} ${process.arch} · first launch · ${startedAt.slice(0, 10)}`
  const hasAnnotated = annotate(clean, annotated, size, title, captions, run.frames[0].at, run.launchedAt)
  const failure = failed ? join(out, "failure.png") : undefined

  if (failure) still(clean, failure)

  const full = installerVideo && existsSync(installerVideo) ? join(out, "installer-and-onboarding.mp4") : undefined

  if (full && installerVideo) concat([installerVideo, hasAnnotated ? annotated : clean], full, size)

  return {
    clean: basename(clean),
    annotated: hasAnnotated ? basename(annotated) : undefined,
    installer: installerVideo ? basename(installerVideo) : undefined,
    full: full ? basename(full) : undefined,
    failure: failure ? basename(failure) : undefined,
  }
}

const CAPTIONS: Record<InvariantID, string> = {
  window: "window",
  splash: "splash",
  "new-session": "new session",
  "composer-focus": "focused",
  "free-model": "model",
  "prompt-sent": "sent",
  working: "working",
  reply: "reply",
}

function copyLogs(root: string) {
  const target = join(out, "logs")

  return sandboxLogs(root).map((file) => {
    const name = `${basename(dirname(file))}-${basename(file)}`
    mkdirSync(target, { recursive: true })
    cpSync(file, join(target, name))

    return `logs/${name}`
  })
}

// The packaged app from 'bun run build && bun run pack' on this platform.
function defaultApp() {
  const dist = join(repository, "dist", "desktop", "app")
  const unpacked = join(repository, "packages", "desktop", "dist")

  const candidates = [
    ...(existsSync(dist) ? readdirSync(dist).map((name) => join(dist, name)) : []),
    ...(existsSync(unpacked)
      ? readdirSync(unpacked).flatMap((dir) =>
          /^(mac|win|linux)/.test(dir) && statSync(join(unpacked, dir)).isDirectory()
            ? readdirSync(join(unpacked, dir)).map((name) => join(unpacked, dir, name))
            : [],
        )
      : []),
  ]

  return (
    candidates.find((file) => /OpenCode[^\\/]*\.(exe|app)$/.test(file) && !/Uninstall/.test(file)) ??
    join(dist, "OpenCode Dev.exe")
  )
}

function bundledCli(app: string) {
  const file = join(
    app.endsWith(".app") ? join(app, "Contents", "Resources") : join(dirname(app), "resources"),
    "opencode-cli.version",
  )

  return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined
}

function executable(app: string) {
  if (!app.endsWith(".app")) return app
  const macos = join(app, "Contents", "MacOS")

  return join(macos, readdirSync(macos)[0])
}

// Windows only: runs the real installer the way a user does, recording the screen, then stops the app it starts
// (that copy uses this machine's profile) so the recorded launch is the first one in a fresh profile.
async function install(source: string) {
  if (process.platform !== "win32") throw new Error("--installer runs Windows installers; pass --app on other systems")

  if (!args.values.disposable)
    throw new Error(
      "--installer installs OpenCode into this machine's user profile, over any copy of that channel already there. Run it on a disposable machine and pass --disposable, or record an unpacked build with --app.",
    )

  const file = /^https?:\/\//.test(source) ? await download(source) : resolve(source)
  const programs = join(process.env.LOCALAPPDATA ?? "", "Programs")
  const video = join(out, "installer.mp4")

  const screen = ffmpegAvailable()
    ? spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "gdigrab",
          "-framerate",
          "30",
          "-i",
          "desktop",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          video,
        ],
        {
          stdio: ["pipe", "ignore", "inherit"],
        },
      )
    : undefined

  await sleep(1000)
  const started = Date.now()
  console.log(`installing ${file}`)
  const code = await new Promise<number | null>((done) => spawn(file, [], { stdio: "ignore" }).once("exit", done))

  if (code !== 0) throw new Error(`The installer exited with code ${code}`)
  // The installer starts the app as it finishes.
  await sleep(4000)

  const exe = existsSync(programs)
    ? readdirSync(programs)
        .flatMap((dir) =>
          existsSync(join(programs, dir)) && statSync(join(programs, dir)).isDirectory()
            ? readdirSync(join(programs, dir)).map((name) => join(programs, dir, name))
            : [],
        )
        .filter(
          (path) =>
            /OpenCode[^\\/]*\.exe$/.test(path) && !/Uninstall/.test(path) && statSync(path).mtimeMs >= started - 5000,
        )
        .at(0)
    : undefined

  if (!exe) throw new Error(`The installer finished but no OpenCode executable appeared under ${programs}`)
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-Process | Where-Object { $_.Path -and ($_.Path.StartsWith('${dirname(exe)}') -or $_.Path -like '*\\opencode-cli*.exe') } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    ],
    { stdio: "ignore" },
  )
  await sleep(1500)

  if (screen) {
    screen.stdin?.end("q")
    await new Promise((done) => screen.once("exit", done))
  }

  return { exe, ms: Date.now() - started, video: screen ? video : undefined }
}

async function download(url: string) {
  const file = join(scratch, "installer.exe")
  console.log(`downloading ${url}`)
  const response = await fetch(url, { redirect: "follow" })

  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
  await Bun.write(file, response)

  return file
}

function within<T>(promise: Promise<T>, ms: number, message: string) {
  return Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error(message)))])
}

function sleep(ms: number) {
  return new Promise<void>((done) => setTimeout(done, ms))
}

mkdirSync(out, { recursive: true })

mkdirSync(frameDir, { recursive: true })

const exitCode = await main().catch((error: Error) => {
  console.error(error.stack ?? error.message)

  return 2
})

rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })

process.exit(exitCode)
