import { render } from "solid-js/web"
import { MetaProvider } from "@solidjs/meta"
import "@opencode-ai/app/index.css"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { Progress } from "@opencode-ai/ui/progress"
import "./styles.css"
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { commands, events, type InitStep, type SqliteMigrationProgress } from "./bindings"
import { Channel } from "@tauri-apps/api/core"
import { initI18n, t } from "./i18n"

const root = document.getElementById("root")!
const delays = [3000, 9000]
const startupClock = typeof performance === "object" ? performance.now() : Date.now()
const startupSeen = new Set<string>()

function profile(phase: string, detail?: string) {
  if (startupSeen.has(phase)) return Promise.resolve()
  startupSeen.add(phase)
  return commands.recordStartupProfile("loading", phase, detail ?? null, performance.now() - startupClock).catch(() => {})
}

render(() => {
  const [step, setStep] = createSignal<InitStep | null>(null)
  const [line, setLine] = createSignal(0)
  const [percent, setPercent] = createSignal(0)
  const [tick, setTick] = createSignal(0)

  void initI18n().then(() => setTick((x) => x + 1))
  void profile("entry.module")

  const phase = createMemo(() => step()?.phase)
  const lines = createMemo(() => {
    tick()
    return [
      t("desktop.loading.status.initial"),
      t("desktop.loading.status.migrating"),
      t("desktop.loading.status.waiting"),
    ]
  })

  const value = createMemo(() => {
    if (phase() === "done") return 100
    return Math.max(25, Math.min(100, percent()))
  })

  const channel = new Channel<InitStep>()
  channel.onmessage = (next) => {
    setStep(next)
    void profile(`init.${next.phase}`)
  }
  commands.awaitInitialization(channel as any).catch(() => undefined)

  onMount(() => {
    void profile("app.mount")
    setLine(0)
    setPercent(0)

    const timers = delays.map((ms, i) => setTimeout(() => setLine(i + 1), ms))

    const listener = events.sqliteMigrationProgress.listen((e) => {
      const payload = e.payload as SqliteMigrationProgress
      if (payload.type === "InProgress") {
        setPercent(Math.max(0, Math.min(100, payload.value)))
        void profile("sqlite.progress", `${payload.value}`)
      }
      if (payload.type === "Done") {
        setPercent(100)
        void profile("sqlite.done")
      }
    })

    onCleanup(() => {
      listener.then((off: () => void) => off())
      timers.forEach(clearTimeout)
    })
  })

  const status = createMemo(() => {
    tick()
    if (phase() === "done") return t("desktop.loading.status.done")
    if (phase() === "sqlite_waiting") return lines()[line()]
    return t("desktop.loading.status.initial")
  })

  createEffect(() => {
    if (phase() !== "done") return
    void profile("app.ready")
  })

  return (
    <MetaProvider>
      <div class="w-screen h-screen bg-background-base flex items-center justify-center p-8 overflow-hidden">
        <Font />
        <div class="w-full max-w-80 flex flex-col items-center gap-11">
          <Splash class="w-20 h-25 opacity-15" />
          <div class="w-full flex flex-col items-center gap-4" aria-live="polite">
            <span class="w-full text-center text-balance text-text-strong text-14-normal leading-6 min-h-12 flex items-center justify-center">
              {status()}
            </span>
            <Progress
              value={value()}
              class="w-24 [&_[data-slot='progress-track']]:h-1 [&_[data-slot='progress-track']]:border-0 [&_[data-slot='progress-track']]:rounded-none [&_[data-slot='progress-track']]:bg-surface-weak [&_[data-slot='progress-fill']]:rounded-none [&_[data-slot='progress-fill']]:bg-icon-warning-base"
              aria-label={t("desktop.loading.progressAria")}
              getValueLabel={({ value }) => `${Math.round(value)}%`}
            />
          </div>
        </div>
      </div>
    </MetaProvider>
  )
}, root)
